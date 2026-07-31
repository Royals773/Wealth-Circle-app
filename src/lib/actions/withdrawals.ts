"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  confirmWithdrawalPaymentSchema,
  decideWithdrawalSchema,
  reasonSchema,
  requestWithdrawalSchema,
  withdrawalPolicyFormSchema,
} from "@/lib/validations/withdrawals";

export interface WithdrawalActionState {
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

async function loadActiveWithdrawalPolicyId(groupId: string) {
  const supabase = await createClient();
  return supabase
    .from("withdrawal_policies")
    .select("id")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function upsertWithdrawalPolicyAction(
  groupId: string,
  _prevState: WithdrawalActionState,
  formData: FormData,
): Promise<WithdrawalActionState> {
  const parsed = withdrawalPolicyFormSchema.safeParse({
    enabled: formData.get("enabled"),
    minAmountMajorUnits: formData.get("minAmountMajorUnits") || undefined,
    maxAmountMajorUnits: formData.get("maxAmountMajorUnits") || undefined,
    noticePeriodDays: formData.get("noticePeriodDays") || undefined,
    allowPartial: formData.get("allowPartial") ?? "true",
    reviewerRoles: formData.getAll("reviewerRoles"),
    requiredApprovals: formData.get("requiredApprovals"),
    allowOverdueMembers: formData.get("allowOverdueMembers") ?? "false",
    blockMembersWithActiveLoans: formData.get("blockMembersWithActiveLoans") ?? "false",
    largeWithdrawalThresholdMajorUnits: formData.get("largeWithdrawalThresholdMajorUnits") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { data: group } = await supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle();

  if (!group) {
    return { status: "error", formError: "Group not found." };
  }

  const { data: existingPolicy } = await loadActiveWithdrawalPolicyId(groupId);
  const { majorToMinorUnits } = await import("@/lib/money");

  const { error } = await supabase.rpc("upsert_withdrawal_policy", {
    p_group_id: groupId,
    p_policy_id: existingPolicy?.id ?? null,
    p_enabled: parsed.data.enabled,
    p_min_amount_minor_units: parsed.data.minAmountMajorUnits
      ? majorToMinorUnits(parsed.data.minAmountMajorUnits, group.currency_code)
      : null,
    p_max_amount_minor_units: parsed.data.maxAmountMajorUnits
      ? majorToMinorUnits(parsed.data.maxAmountMajorUnits, group.currency_code)
      : null,
    p_notice_period_days: parsed.data.noticePeriodDays ?? 0,
    p_allow_partial: parsed.data.allowPartial,
    p_reviewer_roles: parsed.data.reviewerRoles,
    p_required_approvals: parsed.data.requiredApprovals,
    p_allow_overdue_members: parsed.data.allowOverdueMembers,
    p_block_members_with_active_loans: parsed.data.blockMembersWithActiveLoans,
    p_large_withdrawal_threshold_minor_units: parsed.data.largeWithdrawalThresholdMajorUnits
      ? majorToMinorUnits(parsed.data.largeWithdrawalThresholdMajorUnits, group.currency_code)
      : null,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/settings`);
  revalidatePath(`/dashboard/${groupId}/withdrawals`);
  return { status: "success" };
}

export async function requestWithdrawalAction(
  groupId: string,
  _prevState: WithdrawalActionState,
  formData: FormData,
): Promise<WithdrawalActionState> {
  const parsed = requestWithdrawalSchema.safeParse({
    amountMajorUnits: formData.get("amountMajorUnits"),
    reason: formData.get("reason"),
    linkedProposalId: formData.get("linkedProposalId") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { data: group } = await supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle();

  if (!group) {
    return { status: "error", formError: "Group not found." };
  }

  const { majorToMinorUnits } = await import("@/lib/money");

  const { error } = await supabase.rpc("request_withdrawal", {
    p_group_id: groupId,
    p_amount_minor_units: majorToMinorUnits(parsed.data.amountMajorUnits, group.currency_code),
    p_reason: parsed.data.reason,
    p_linked_proposal_id: parsed.data.linkedProposalId ?? null,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/withdrawals`);
  revalidatePath(`/dashboard/${groupId}`);
  return { status: "success" };
}

export async function cancelWithdrawalRequestAction(
  groupId: string,
  requestId: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_withdrawal_request", { p_request_id: requestId });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/withdrawals`);
  return {};
}

export async function reviewWithdrawalRequestAction(
  groupId: string,
  requestId: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_withdrawal_request", { p_request_id: requestId });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/withdrawals`);
  return {};
}

export async function decideWithdrawalRequestAction(
  groupId: string,
  _prevState: WithdrawalActionState,
  formData: FormData,
): Promise<WithdrawalActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const parsed = decideWithdrawalSchema.safeParse({
    decision: formData.get("decision"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success || !requestId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_withdrawal_request", {
    p_request_id: requestId,
    p_decision: parsed.data.decision,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/withdrawals`);
  revalidatePath(`/dashboard/${groupId}/approvals`);
  return { status: "success" };
}

export async function confirmWithdrawalPaymentAction(
  groupId: string,
  _prevState: WithdrawalActionState,
  formData: FormData,
): Promise<WithdrawalActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const parsed = confirmWithdrawalPaymentSchema.safeParse({
    bankReference: formData.get("bankReference"),
    paidAt: formData.get("paidAt"),
    note: formData.get("note") || undefined,
  });

  if (!parsed.success || !requestId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("withdrawal_requests")
    .select("amount_minor_units")
    .eq("id", requestId)
    .maybeSingle();

  if (!request) {
    return { status: "error", formError: "Withdrawal request not found." };
  }

  const { error } = await supabase.rpc("confirm_withdrawal_payment", {
    p_request_id: requestId,
    p_paid_amount_minor_units: request.amount_minor_units,
    p_bank_reference: parsed.data.bankReference,
    p_paid_at: parsed.data.paidAt,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/withdrawals`);
  return { status: "success" };
}

export async function reverseWithdrawalPaymentAction(
  groupId: string,
  _prevState: WithdrawalActionState,
  formData: FormData,
): Promise<WithdrawalActionState> {
  const requestId = String(formData.get("requestId") ?? "");
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });

  if (!parsed.success || !requestId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_withdrawal_payment", {
    p_request_id: requestId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/withdrawals`);
  return { status: "success" };
}
