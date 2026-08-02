"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { flushPendingNotificationEmails } from "@/lib/actions/notifications";
import { getAppUrl } from "@/lib/env";
import { initialInviteSchema } from "@/lib/validations/group";
import type { AuthActionState } from "@/lib/actions/auth";

export interface InvitationActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Only ever populated once, immediately after creation — the raw
   * token is never stored, so this is the only chance to show the link. */
  inviteLink?: string;
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

  return {
    status: "success",
    inviteLink: `${getAppUrl()}/invitations/${invitation.raw_token}`,
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
