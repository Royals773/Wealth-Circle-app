import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  isSupabaseConfigured: true,
  getAppUrl: () => "https://example.test",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue(true) }));

const sendNotificationEmail = vi.fn();
vi.mock("@/lib/email/mailer", () => ({ sendNotificationEmail: (...args: unknown[]) => sendNotificationEmail(...args) }));

let rpcImpl: (name: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    rpc: (name: string, args: unknown) => rpcImpl(name, args),
  }),
}));

import { createInvitationAction } from "@/lib/actions/invitations";

const GROUP_ID = "11111111-1111-1111-1111-111111111111";
const INVITEE_EMAIL = "invitee@example.com";

function formData(email: string, role = "member") {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("role", role);
  return fd;
}

describe("createInvitationAction — email dispatch", () => {
  afterEach(() => {
    sendNotificationEmail.mockReset();
  });

  it("1/2/3: on success, calls sendNotificationEmail exactly once, with the validated invitee email and the exact returned link", async () => {
    rpcImpl = async () => ({
      data: [{ invitation_id: "inv-1", raw_token: "raw-token-abc" }],
      error: null,
    });
    sendNotificationEmail.mockResolvedValue({ ok: true });

    const result = await createInvitationAction(GROUP_ID, { status: "idle" }, formData(INVITEE_EMAIL));

    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(sendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: INVITEE_EMAIL, actionUrl: result.inviteLink }),
    );
    expect(result.inviteLink).toBe("https://example.test/invitations/raw-token-abc");
  });

  it("4: SMTP success returns emailStatus: 'sent'", async () => {
    rpcImpl = async () => ({ data: [{ invitation_id: "inv-1", raw_token: "tok" }], error: null });
    sendNotificationEmail.mockResolvedValue({ ok: true });

    const result = await createInvitationAction(GROUP_ID, { status: "idle" }, formData(INVITEE_EMAIL));

    expect(result.status).toBe("success");
    expect(result.emailStatus).toBe("sent");
  });

  it("5: SMTP failure still returns a successful invitation with a valid link and emailStatus: 'failed'", async () => {
    rpcImpl = async () => ({ data: [{ invitation_id: "inv-1", raw_token: "tok" }], error: null });
    sendNotificationEmail.mockResolvedValue({ ok: false, error: "535 Authentication credentials invalid" });

    const result = await createInvitationAction(GROUP_ID, { status: "idle" }, formData(INVITEE_EMAIL));

    expect(result.status).toBe("success");
    expect(result.inviteLink).toBe("https://example.test/invitations/tok");
    expect(result.emailStatus).toBe("failed");
  });

  it("6: the action's own return value never carries the raw SMTP error, invite link, or token in any logged/error field", async () => {
    rpcImpl = async () => ({ data: [{ invitation_id: "inv-1", raw_token: "secret-token" }], error: null });
    sendNotificationEmail.mockResolvedValue({ ok: false, error: "535 Authentication credentials invalid" });

    const result = await createInvitationAction(GROUP_ID, { status: "idle" }, formData(INVITEE_EMAIL));

    // formError is the only field a browser ever surfaces as an error —
    // it must never contain the raw SMTP error or the token.
    expect(result.formError).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("535 Authentication credentials invalid");
  });

  it("7: a duplicate/failed RPC (e.g. already-pending invitation) does not send an email", async () => {
    rpcImpl = async () => ({ data: null, error: { message: "There is already a pending invitation for that email address" } });

    const result = await createInvitationAction(GROUP_ID, { status: "idle" }, formData(INVITEE_EMAIL));

    expect(result.status).toBe("error");
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it("8: an authorisation failure from the RPC (non-manager caller) does not send an email", async () => {
    rpcImpl = async () => ({ data: null, error: { message: "Only group owners and administrators can create invitations" } });

    const result = await createInvitationAction(GROUP_ID, { status: "idle" }, formData(INVITEE_EMAIL));

    expect(result.status).toBe("error");
    expect(sendNotificationEmail).not.toHaveBeenCalled();
  });

  it("11: exactly one email call happens for one successful action invocation, not more", async () => {
    rpcImpl = async () => ({ data: [{ invitation_id: "inv-1", raw_token: "tok" }], error: null });
    sendNotificationEmail.mockResolvedValue({ ok: true });

    await createInvitationAction(GROUP_ID, { status: "idle" }, formData(INVITEE_EMAIL));

    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  });
});
