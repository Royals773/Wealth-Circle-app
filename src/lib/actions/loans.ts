"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { flushPendingNotificationEmails } from "@/lib/actions/notifications";
import { LENDING_DISABLED, LENDING_DISABLED_MESSAGE, loanRpcErrorMessage } from "@/lib/lending-gate";
import {
  disbursementSchema,
  loanApplicationSchema,
  loanDecisionSchema,
  loanPolicyFormSchema,
  reasonSchema,
  recordRepaymentSchema,
  reverseRepaymentSchema,
} from "@/lib/validations/loans";

export interface LoanActionState {
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

async function loadActiveLoanProduct(groupId: string) {
  const supabase = await createClient();
  return supabase
    .from("loan_products")
    .select("id")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function upsertLoanPolicyAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const parsed = loanPolicyFormSchema.safeParse({
    enabled: formData.get("enabled"),
    maxLoanPercent: formData.get("maxLoanPercent"),
    maxAmountMajorUnits: formData.get("maxAmountMajorUnits") || undefined,
    interestRatePercent: formData.get("interestRatePercent"),
    minTermMonths: formData.get("minTermMonths") || undefined,
    maxTermMonths: formData.get("maxTermMonths"),
    repaymentFrequency: formData.get("repaymentFrequency"),
    allowOverdueMembers: formData.get("allowOverdueMembers") ?? "false",
    gracePeriodDays: formData.get("gracePeriodDays") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { data: group } = await supabase
    .from("groups")
    .select("currency_code")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) {
    return { status: "error", formError: "Group not found." };
  }

  const { data: existingProduct } = await loadActiveLoanProduct(groupId);
  const { majorToMinorUnits } = await import("@/lib/money");

  const { error } = await supabase.rpc("upsert_loan_product", {
    p_group_id: groupId,
    p_product_id: existingProduct?.id ?? null,
    p_enabled: parsed.data.enabled,
    p_max_loan_bps_of_contributions: Math.round(parsed.data.maxLoanPercent * 100),
    p_max_amount_minor_units: parsed.data.maxAmountMajorUnits
      ? majorToMinorUnits(parsed.data.maxAmountMajorUnits, group.currency_code)
      : null,
    p_interest_type: "one_time_flat",
    p_interest_rate_bps: Math.round(parsed.data.interestRatePercent * 100),
    p_min_term_months: parsed.data.minTermMonths ?? null,
    p_max_term_months: parsed.data.maxTermMonths,
    p_repayment_frequency: parsed.data.repaymentFrequency,
    p_allow_overdue_members: parsed.data.allowOverdueMembers,
    p_grace_period_days: parsed.data.gracePeriodDays ?? 0,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/settings`);
  revalidatePath(`/dashboard/${groupId}/loans`);
  return { status: "success" };
}

export async function applyForLoanAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const parsed = loanApplicationSchema.safeParse({
    amountMajorUnits: formData.get("amountMajorUnits"),
    termMonths: formData.get("termMonths"),
    purpose: formData.get("purpose") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  if (LENDING_DISABLED) {
    return { status: "error", formError: LENDING_DISABLED_MESSAGE };
  }

  const supabase = await createClient();
  const { data: group } = await supabase
    .from("groups")
    .select("currency_code")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) {
    return { status: "error", formError: "Group not found." };
  }

  const { majorToMinorUnits } = await import("@/lib/money");

  const { error } = await supabase.rpc("apply_for_loan", {
    p_group_id: groupId,
    p_amount_minor_units: majorToMinorUnits(parsed.data.amountMajorUnits, group.currency_code),
    p_term_months: parsed.data.termMonths,
    p_purpose: parsed.data.purpose ?? null,
  });

  if (error) {
    return { status: "error", formError: loanRpcErrorMessage(error) };
  }

  revalidatePath(`/dashboard/${groupId}/loans`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function markUnderReviewAction(groupId: string, applicationId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };
  if (LENDING_DISABLED) return { error: LENDING_DISABLED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_loan_under_review", { p_application_id: applicationId });

  if (error) return { error: loanRpcErrorMessage(error) };

  revalidatePath(`/dashboard/${groupId}/loans`);
  return {};
}

export async function cancelLoanApplicationAction(
  groupId: string,
  applicationId: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };
  if (LENDING_DISABLED) return { error: LENDING_DISABLED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_loan_application", { p_application_id: applicationId });

  if (error) return { error: loanRpcErrorMessage(error) };

  revalidatePath(`/dashboard/${groupId}/loans`);
  return {};
}

export async function decideLoanApplicationAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const applicationId = String(formData.get("applicationId") ?? "");
  const parsed = loanDecisionSchema.safeParse({
    decision: formData.get("decision"),
    approvedAmountMajorUnits: formData.get("approvedAmountMajorUnits") || undefined,
    approvedTermMonths: formData.get("approvedTermMonths") || undefined,
    approvedInterestRatePercent: formData.get("approvedInterestRatePercent") || undefined,
    approvedRepaymentFrequency: formData.get("approvedRepaymentFrequency") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success || !applicationId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  if (LENDING_DISABLED) {
    return { status: "error", formError: LENDING_DISABLED_MESSAGE };
  }

  const supabase = await createClient();

  let approvedAmountMinorUnits: number | null = null;
  if (parsed.data.decision === "approved" && parsed.data.approvedAmountMajorUnits !== undefined) {
    const { data: application } = await supabase
      .from("loan_applications")
      .select("currency_code")
      .eq("id", applicationId)
      .maybeSingle();

    if (!application) {
      return { status: "error", formError: "Application not found." };
    }

    const { majorToMinorUnits } = await import("@/lib/money");
    approvedAmountMinorUnits = majorToMinorUnits(parsed.data.approvedAmountMajorUnits, application.currency_code);
  }

  const { error } = await supabase.rpc("decide_loan_application", {
    p_application_id: applicationId,
    p_decision: parsed.data.decision,
    p_approved_amount_minor_units: approvedAmountMinorUnits,
    p_approved_term_months: parsed.data.approvedTermMonths ?? null,
    p_approved_interest_rate_bps:
      parsed.data.approvedInterestRatePercent !== undefined
        ? Math.round(parsed.data.approvedInterestRatePercent * 100)
        : null,
    p_approved_repayment_frequency: parsed.data.approvedRepaymentFrequency ?? null,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    return { status: "error", formError: loanRpcErrorMessage(error) };
  }

  revalidatePath(`/dashboard/${groupId}/loans`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function recordDisbursementAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const loanId = String(formData.get("loanId") ?? "");
  const parsed = disbursementSchema.safeParse({
    disbursementDate: formData.get("disbursementDate"),
    disbursementReference: formData.get("disbursementReference") || undefined,
    disbursementNote: formData.get("disbursementNote") || undefined,
  });

  if (!parsed.success || !loanId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  if (LENDING_DISABLED) {
    return { status: "error", formError: LENDING_DISABLED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_disbursement", {
    p_loan_id: loanId,
    p_disbursement_date: parsed.data.disbursementDate,
    p_disbursement_reference: parsed.data.disbursementReference ?? null,
    p_disbursement_note: parsed.data.disbursementNote ?? null,
  });

  if (error) {
    return { status: "error", formError: loanRpcErrorMessage(error) };
  }

  revalidatePath(`/dashboard/${groupId}/loans`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function markLoanDefaultedAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const loanId = String(formData.get("loanId") ?? "");
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });

  if (!parsed.success || !loanId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  if (LENDING_DISABLED) {
    return { status: "error", formError: LENDING_DISABLED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_loan_defaulted", { p_loan_id: loanId, p_reason: parsed.data.reason });

  if (error) {
    return { status: "error", formError: loanRpcErrorMessage(error) };
  }

  revalidatePath(`/dashboard/${groupId}/loans`);
  return { status: "success" };
}

export async function recordRepaymentAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const loanId = String(formData.get("loanId") ?? "");
  const parsed = recordRepaymentSchema.safeParse({
    amountMajorUnits: formData.get("amountMajorUnits"),
    receivedAt: formData.get("receivedAt"),
    paymentMethod: formData.get("paymentMethod"),
    paymentReference: formData.get("paymentReference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success || !loanId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  if (LENDING_DISABLED) {
    return { status: "error", formError: LENDING_DISABLED_MESSAGE };
  }

  const supabase = await createClient();
  const { data: loan } = await supabase.from("loans").select("currency_code").eq("id", loanId).maybeSingle();

  if (!loan) {
    return { status: "error", formError: "Loan not found." };
  }

  const { majorToMinorUnits } = await import("@/lib/money");

  const { error } = await supabase.rpc("record_repayment", {
    p_loan_id: loanId,
    p_amount_minor_units: majorToMinorUnits(parsed.data.amountMajorUnits, loan.currency_code),
    p_received_at: parsed.data.receivedAt,
    p_payment_method: parsed.data.paymentMethod,
    p_payment_reference: parsed.data.paymentReference ?? null,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    return { status: "error", formError: loanRpcErrorMessage(error) };
  }

  revalidatePath(`/dashboard/${groupId}/repayments`);
  revalidatePath(`/dashboard/${groupId}/loans`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function verifyRepaymentAction(groupId: string, repaymentId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };
  if (LENDING_DISABLED) return { error: LENDING_DISABLED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_repayment", { p_repayment_id: repaymentId });

  if (error) return { error: loanRpcErrorMessage(error) };

  revalidatePath(`/dashboard/${groupId}/repayments`);
  await flushPendingNotificationEmails();
  return {};
}

export async function reconcileRepaymentAction(groupId: string, repaymentId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };
  if (LENDING_DISABLED) return { error: LENDING_DISABLED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reconcile_repayment", { p_repayment_id: repaymentId });

  if (error) return { error: loanRpcErrorMessage(error) };

  revalidatePath(`/dashboard/${groupId}/repayments`);
  return {};
}

export async function rejectRepaymentAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const repaymentId = String(formData.get("repaymentId") ?? "");
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });

  if (!parsed.success || !repaymentId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  if (LENDING_DISABLED) {
    return { status: "error", formError: LENDING_DISABLED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_repayment", {
    p_repayment_id: repaymentId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: loanRpcErrorMessage(error) };
  }

  revalidatePath(`/dashboard/${groupId}/repayments`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

export async function reverseRepaymentAction(
  groupId: string,
  _prevState: LoanActionState,
  formData: FormData,
): Promise<LoanActionState> {
  const repaymentId = String(formData.get("repaymentId") ?? "");
  const parsed = reverseRepaymentSchema.safeParse({
    reason: formData.get("reason"),
    createReplacement: formData.get("createReplacement") ?? "false",
    amountMajorUnits: formData.get("amountMajorUnits") || undefined,
    receivedAt: formData.get("receivedAt") || undefined,
    paymentMethod: formData.get("paymentMethod") || undefined,
    paymentReference: formData.get("paymentReference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success || !repaymentId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  if (LENDING_DISABLED) {
    return { status: "error", formError: LENDING_DISABLED_MESSAGE };
  }

  const supabase = await createClient();
  let replacement: Record<string, string | number> | null = null;

  if (parsed.data.createReplacement) {
    replacement = {};
    if (parsed.data.amountMajorUnits !== undefined) {
      const { data: repayment } = await supabase
        .from("repayments")
        .select("currency_code")
        .eq("id", repaymentId)
        .maybeSingle();
      if (repayment) {
        const { majorToMinorUnits } = await import("@/lib/money");
        replacement.amount_minor_units = majorToMinorUnits(parsed.data.amountMajorUnits, repayment.currency_code);
      }
    }
    if (parsed.data.receivedAt !== undefined) replacement.received_at = parsed.data.receivedAt;
    if (parsed.data.paymentMethod !== undefined) replacement.payment_method = parsed.data.paymentMethod;
    if (parsed.data.paymentReference !== undefined) replacement.payment_reference = parsed.data.paymentReference;
    if (parsed.data.notes !== undefined) replacement.notes = parsed.data.notes;
  }

  const { error } = await supabase.rpc("reverse_repayment", {
    p_repayment_id: repaymentId,
    p_reason: parsed.data.reason,
    p_replacement: replacement,
  });

  if (error) {
    return { status: "error", formError: loanRpcErrorMessage(error) };
  }

  revalidatePath(`/dashboard/${groupId}/repayments`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}
