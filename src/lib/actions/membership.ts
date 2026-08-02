"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { flushPendingNotificationEmails } from "@/lib/actions/notifications";
import {
  changeRoleSchema,
  initiateTransferSchema,
  optionalReasonSchema,
  reasonSchema,
} from "@/lib/validations/membership";

export interface MembershipActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
}

const NOT_CONFIGURED_MESSAGE =
  "This isn't available in this preview yet — Supabase credentials haven't been configured.";

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function changeMemberRoleAction(
  groupId: string,
  memberId: string,
  _prevState: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const parsed = changeRoleSchema.safeParse({
    newRole: formData.get("newRole"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_member_role", {
    p_group_id: groupId,
    p_member_id: memberId,
    p_new_role: parsed.data.newRole,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function suspendMemberAction(
  groupId: string,
  memberId: string,
  _prevState: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_member", {
    p_group_id: groupId,
    p_member_id: memberId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function reactivateMemberAction(groupId: string, memberId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reactivate_member", {
    p_group_id: groupId,
    p_member_id: memberId,
    p_reason: null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return {};
}

export async function removeMemberAction(
  groupId: string,
  memberId: string,
  _prevState: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_group_id: groupId,
    p_member_id: memberId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function leaveGroupAction(
  groupId: string,
  _prevState: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const parsed = optionalReasonSchema.safeParse({ reason: formData.get("reason") || undefined });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_group", {
    p_group_id: groupId,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  redirect("/dashboard");
}

export async function initiateOwnershipTransferAction(
  groupId: string,
  _prevState: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const parsed = initiateTransferSchema.safeParse({
    toUserId: formData.get("toUserId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("initiate_ownership_transfer", {
    p_group_id: groupId,
    p_to_user_id: parsed.data.toUserId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function acceptOwnershipTransferAction(groupId: string, transferId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_ownership_transfer", { p_transfer_id: transferId });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return {};
}

export async function declineOwnershipTransferAction(groupId: string, transferId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_ownership_transfer", {
    p_transfer_id: transferId,
    p_reason: null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return {};
}

export async function cancelOwnershipTransferAction(
  groupId: string,
  _prevState: MembershipActionState,
  formData: FormData,
): Promise<MembershipActionState> {
  const transferId = String(formData.get("transferId") ?? "");
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });

  if (!parsed.success || !transferId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_ownership_transfer", {
    p_transfer_id: transferId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/members`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}
