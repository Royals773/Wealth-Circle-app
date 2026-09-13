/**
 * Live Row Level Security and invitation-lifecycle tests.
 *
 * Runs against the real Supabase project configured in .env.local — see
 * README.md in this folder for what it needs and how to run it
 * (`npm run test:security`). Skipped automatically (not failed) when the
 * required env vars aren't present, so it never blocks the standard
 * build/lint/test gate.
 *
 * SUPABASE_SECRET_KEY is used ONLY here, and only for two things that
 * genuinely require it: pre-confirming throwaway test users (so the
 * suite doesn't depend on real email delivery) and deleting test
 * fixtures afterward. Every actual assertion below runs through a
 * publishable-key client signed in as a real test user, so it exercises
 * exactly the same RLS path the application does — the secret key never
 * substitutes for or bypasses what's being tested.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateTestPassword } from "./test-fixtures";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const userAEmail = `wc-security-test-a-${runId}@example.com`;
const userBEmail = `wc-security-test-b-${runId}@example.com`;
const testPassword = generateTestPassword();

describe.skipIf(!isConfigured)("tenant isolation and invitation lifecycle (live)", () => {
  let adminClient: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let anonClient: SupabaseClient;
  let userAId: string;
  let userBId: string;
  let groupAId: string;
  let groupBId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userA, error: userAErr } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: "Security Test User A" },
    });
    if (userAErr || !userA.user) throw new Error(`Failed to create test user A: ${userAErr?.message}`);
    userAId = userA.user.id;

    const { data: userB, error: userBErr } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: "Security Test User B" },
    });
    if (userBErr || !userB.user) throw new Error(`Failed to create test user B: ${userBErr?.message}`);
    userBId = userB.user.id;

    clientA = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInAErr } = await clientA.auth.signInWithPassword({
      email: userAEmail,
      password: testPassword,
    });
    if (signInAErr) throw new Error(`Failed to sign in test user A: ${signInAErr.message}`);

    clientB = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInBErr } = await clientB.auth.signInWithPassword({
      email: userBEmail,
      password: testPassword,
    });
    if (signInBErr) throw new Error(`Failed to sign in test user B: ${signInBErr.message}`);

    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  afterAll(async () => {
    if (!adminClient) return;
    // Deleting the groups cascades to memberships, invitations,
    // contribution plans and audit logs (all group_id columns are
    // `on delete cascade` — see supabase/migrations/0001_init.sql).
    if (groupAId) await adminClient.from("groups").delete().eq("id", groupAId);
    if (groupBId) await adminClient.from("groups").delete().eq("id", groupBId);
    const orgAppUserIds = [userAId, userBId].filter(Boolean);
    if (orgAppUserIds.length) {
      await adminClient.from("organiser_applications").delete().in("user_id", orgAppUserIds);
    }
    if (userAId) await adminClient.auth.admin.deleteUser(userAId);
    if (userBId) await adminClient.auth.admin.deleteUser(userBId);
  });

  it("creates a group and its owner membership atomically", async () => {
    await adminClient.from("organiser_applications").insert({ user_id: userAId, status: "approved" });
    const { data, error } = await clientA.rpc("create_group_with_setup", {
      p_name: "Security Test Group A",
      p_slug: `sec-test-group-a-${runId}`,
      p_description: null,
      p_country_code: "GB",
      p_currency_code: "GBP",
      p_contribution_frequency: "monthly",
      p_contribution_type: "flexible",
      p_fixed_amount_minor_units: null,
      p_financial_year_start_month: 1,
      p_rules: null,
      p_invites: [],
    });

    expect(error).toBeNull();
    groupAId = data?.[0]?.group_id as string;
    await adminClient.from("groups").update({ status: "active" }).eq("id", groupAId);
    expect(groupAId).toBeTruthy();

    const { data: membership } = await clientA
      .from("group_memberships")
      .select("role")
      .eq("group_id", groupAId)
      .eq("user_id", userAId)
      .single();

    expect(membership?.role).toBe("owner");

    const { data: auditRows } = await clientA
      .from("audit_logs")
      .select("action")
      .eq("group_id", groupAId)
      .eq("action", "group_created");
    expect(auditRows?.length).toBe(1);
  });

  it("creates a second, independent group for user B", async () => {
    await adminClient.from("organiser_applications").insert({ user_id: userBId, status: "approved" });
    const { data, error } = await clientB.rpc("create_group_with_setup", {
      p_name: "Security Test Group B",
      p_slug: `sec-test-group-b-${runId}`,
      p_description: null,
      p_country_code: "GB",
      p_currency_code: "GBP",
      p_contribution_frequency: "monthly",
      p_contribution_type: "flexible",
      p_fixed_amount_minor_units: null,
      p_financial_year_start_month: 1,
      p_rules: null,
      p_invites: [],
    });

    expect(error).toBeNull();
    groupBId = data?.[0]?.group_id as string;
    await adminClient.from("groups").update({ status: "active" }).eq("id", groupBId);
    expect(groupBId).toBeTruthy();
  });

  it("does not let a user read another user's profile with no shared group", async () => {
    const { data } = await clientA.from("profiles").select("id").eq("id", userBId);
    expect(data).toEqual([]);
  });

  it("does not let a member of Group A read Group B (and vice versa)", async () => {
    const { data: bReadingA } = await clientB.from("groups").select("id").eq("id", groupAId);
    expect(bReadingA).toEqual([]);

    const { data: aReadingB } = await clientA.from("groups").select("id").eq("id", groupBId);
    expect(aReadingB).toEqual([]);

    const { data: bReadingAMemberships } = await clientB
      .from("group_memberships")
      .select("id")
      .eq("group_id", groupAId);
    expect(bReadingAMemberships).toEqual([]);
  });

  it("does not let anonymous users read any group data", async () => {
    const { data: groups } = await anonClient.from("groups").select("id").eq("id", groupAId);
    expect(groups).toEqual([]);

    const { data: memberships } = await anonClient
      .from("group_memberships")
      .select("id")
      .eq("group_id", groupAId);
    expect(memberships).toEqual([]);
  });

  it("does not let a user change their own membership row (self-promotion)", async () => {
    const { data: ownRow } = await clientA
      .from("group_memberships")
      .select("id")
      .eq("group_id", groupAId)
      .eq("user_id", userAId)
      .single();

    const { data: updated, error } = await clientA
      .from("group_memberships")
      .update({ role: "owner" })
      .eq("id", ownRow!.id)
      .select();

    // Since Phase 7 (0013_phase7_member_management.sql), a user's own
    // active row IS visible under the "leave own membership" policy's
    // USING clause — that's what lets someone leave a group themselves.
    // But its WITH CHECK only permits transitioning to status =
    // 'removed', so an attempt to change role instead (leaving status
    // untouched) fails WITH CHECK and errors, rather than silently
    // matching zero rows the way it did under the old, narrower
    // Phase 1 policy.
    expect(updated).toBeNull();
    expect(error).not.toBeNull();
  });

  let firstInviteToken: string;

  it("lets an owner invite a member, who can then accept (full invitation lifecycle)", async () => {
    const { data: invite, error: inviteErr } = await clientA.rpc("create_invitation", {
      p_group_id: groupAId,
      p_email: userBEmail,
      p_role: "member",
    });
    expect(inviteErr).toBeNull();
    firstInviteToken = invite?.[0]?.raw_token as string;
    expect(firstInviteToken).toBeTruthy();

    const { data: preview, error: previewErr } = await anonClient.rpc("get_invitation_preview", {
      p_token: firstInviteToken,
    });
    expect(previewErr).toBeNull();
    expect(preview?.[0]?.group_name).toBe("Security Test Group A");
    expect(preview?.[0]?.role).toBe("member");

    const { data: accepted, error: acceptErr } = await clientB.rpc("accept_invitation", {
      p_token: firstInviteToken,
    });
    expect(acceptErr).toBeNull();
    expect(accepted?.[0]?.group_id).toBe(groupAId);
    expect(accepted?.[0]?.role).toBe("member");

    const { data: membership } = await clientB
      .from("group_memberships")
      .select("role")
      .eq("group_id", groupAId)
      .eq("user_id", userBId)
      .single();
    expect(membership?.role).toBe("member");
  });

  it("does not let an invitation be accepted twice", async () => {
    const { error } = await clientB.rpc("accept_invitation", { p_token: firstInviteToken });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already been used/i);
  });

  it("does not let an ordinary member create privileged invitations", async () => {
    const { error } = await clientB.rpc("create_invitation", {
      p_group_id: groupAId,
      p_email: "someone-else@example.com",
      p_role: "member",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owners and administrators/i);
  });

  it("does not let a revoked invitation be used", async () => {
    const { data: invite } = await clientA.rpc("create_invitation", {
      p_group_id: groupAId,
      p_email: userBEmail,
      p_role: "treasurer",
    });
    const token = invite?.[0]?.raw_token as string;
    const invitationId = invite?.[0]?.invitation_id as string;

    const { error: revokeErr } = await clientA.rpc("revoke_invitation", {
      p_invitation_id: invitationId,
    });
    expect(revokeErr).toBeNull();

    const { error: useRevokedErr } = await clientB.rpc("accept_invitation", { p_token: token });
    expect(useRevokedErr).not.toBeNull();
    expect(useRevokedErr?.message).toMatch(/revoked/i);
  });

  it("does not let an expired invitation be used", async () => {
    const { data: invite } = await clientA.rpc("create_invitation", {
      p_group_id: groupAId,
      p_email: userBEmail,
      p_role: "auditor",
    });
    const token = invite?.[0]?.raw_token as string;
    const invitationId = invite?.[0]?.invitation_id as string;

    // Only the admin client can backdate this — there's no client-facing
    // way to create an already-expired invitation, by design.
    await adminClient
      .from("group_invitations")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", invitationId);

    const { error } = await clientB.rpc("accept_invitation", { p_token: token });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/expired/i);
  });

  it("gives a user the correct, independent role in each group they belong to", async () => {
    const { data: membershipsB } = await clientB
      .from("group_memberships")
      .select("group_id, role")
      .eq("user_id", userBId);

    const roleInA = membershipsB?.find((m) => m.group_id === groupAId)?.role;
    const roleInB = membershipsB?.find((m) => m.group_id === groupBId)?.role;

    expect(roleInA).toBe("member");
    expect(roleInB).toBe("owner");

    const groupIds = (membershipsB ?? []).map((m) => m.group_id).sort();
    expect(groupIds).toEqual([groupAId, groupBId].sort());
  });

  it("only lets owners/administrators/auditors read the audit log", async () => {
    const { data: asOwner } = await clientA
      .from("audit_logs")
      .select("action")
      .eq("group_id", groupAId);
    const actions = (asOwner ?? []).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "group_created",
        "invitation_created",
        "invitation_accepted",
        "invitation_revoked",
      ]),
    );

    const { data: asMember } = await clientB
      .from("audit_logs")
      .select("id")
      .eq("group_id", groupAId);
    expect(asMember).toEqual([]);
  });
});
