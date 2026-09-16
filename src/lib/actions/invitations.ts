"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { flushPendingNotificationEmails } from "@/lib/actions/notifications";
import { getAppUrl } from "@/lib/env";
import { initialInviteSchema } from "@/lib/validations/group";
import type { AuthActionState } from "@/lib/actions/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendNotificationEmail } from "@/lib/email/mailer";

export interface InvitationActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Only ever populated once, immediately after creation — the raw
   * token is never stored, so this is the only chance to show the link. */
  inviteLink?: string;
  /** Whether the invitee's email was actually delivered. A "failed" value
   * never invalidates the invitation itself — inviteLink is still valid
   * and still the UI's fallback regardless of this outcome. Never carries
   * the raw SMTP error; sendNotificationEmail() already logs that safely
   * server-side (src/lib/email/mailer.ts) without token/credential
   * exposure — nothing further to log here. */
  emailStatus?: "sent" | "failed";
}

const NOT_CONFIGURED_MESSAGE =
  "This isn't available in this preview yet — Supabase credentials haven't been configured.";

export async function createInvitationAction(
  groupId: string,
  _prevState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const parsed = initialInviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] = issue.message;
    }
    return { status: "error", fieldErrors };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    // Fails open on any error, including the migration not being
    // deployed yet — see src/lib/rate-limit.ts.
    const allowed = await checkRateLimit({ key: `invite:${user.id}:${groupId}`, windowSeconds: 3600, max: 20 });
    if (!allowed) {
      return { status: "error", formError: "Too many invitations sent recently. Please try again in a while." };
    }
  }

  const { data, error } = await supabase.rpc("create_invitation", {
    p_group_id: groupId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });

  const invitation = data?.[0];

  if (error || !invitation) {
    return {
      status: "error",
      formError: error?.message ?? "Could not create the invitation. Please try again.",
    };
  }

  revalidatePath(`/dashboard/${groupId}/members`);

  const inviteLink = `${getAppUrl()}/invitations/${invitation.raw_token}`;

  // Sent directly, not via the notifications-table + scheduler queue used
  // elsewhere: that queue requires an existing recipient_id, but an
  // invitee may not have an account yet — this is the one notification
  // type that can't go through create_notification(). Email failure is
  // non-fatal: the invitation above is already valid and already
  // returned to the caller regardless.
  const emailResult = await sendNotificationEmail({
    to: parsed.data.email,
    title: "You've been invited to join a WealthCircle group",
    actionUrl: inviteLink,
  });

  return {
    status: "success",
    inviteLink,
    emailStatus: emailResult.ok ? "sent" : "failed",
  };
}

export async function revokeInvitationAction(
  groupId: string,
  invitationId: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", {
    p_invitation_id: invitationId,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return {};
}

/**
 * Called from the invitation page once the visitor is authenticated and
 * has confirmed they want to join. The role is never taken from the
 * client — public.accept_invitation() reads it from the invitation row
 * itself, so this action can't be used to request a different role.
 */
export async function confirmAcceptInvitationAction(
  token: string,
  // Required by useActionState's action signature — token is bound via
  // .bind(null, token) in the component, so these two are always unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: AuthActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  const result = data?.[0];

  if (error || !result) {
    return {
      status: "error",
      formError: error?.message ?? "We couldn't accept this invitation. Please try again.",
    };
  }

  await flushPendingNotificationEmails();
  redirect(`/dashboard/${result.group_id}`);
}
