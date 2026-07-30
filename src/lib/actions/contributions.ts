"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getPeriodContaining } from "@/lib/contribution-periods";
import {
  contributionPlanFormSchema,
  reasonSchema,
  recordContributionSchema,
  reverseContributionSchema,
} from "@/lib/validations/contributions";
import type { ContributionFrequency, PaymentMethod } from "@/lib/types/database";

export interface ContributionActionState {
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

async function loadActivePlan(groupId: string) {
  const supabase = await createClient();
  return supabase
    .from("contribution_plans")
    .select("id, frequency, start_date, currency_code")
    .eq("group_id", groupId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function upsertContributionPlanAction(
  groupId: string,
  _prevState: ContributionActionState,
  formData: FormData,
): Promise<ContributionActionState> {
  const parsed = contributionPlanFormSchema.safeParse({
    isFlexible: formData.get("isFlexible"),
    amountMajorUnits: formData.get("amountMajorUnits") || undefined,
    minimumAmountMajorUnits: formData.get("minimumAmountMajorUnits") || undefined,
    frequency: formData.get("frequency"),
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

  const { data: existingPlan } = await loadActivePlan(groupId);
  const { majorToMinorUnits } = await import("@/lib/money");

  const { error } = await supabase.rpc("upsert_contribution_plan", {
    p_group_id: groupId,
    p_plan_id: existingPlan?.id ?? null,
    p_is_flexible: parsed.data.isFlexible,
    p_amount_minor_units: parsed.data.amountMajorUnits
      ? majorToMinorUnits(parsed.data.amountMajorUnits, group.currency_code)
      : null,
    p_minimum_amount_minor_units: parsed.data.minimumAmountMajorUnits
      ? majorToMinorUnits(parsed.data.minimumAmountMajorUnits, group.currency_code)
      : null,
    p_frequency: parsed.data.frequency,
    p_start_date: new Date().toISOString().slice(0, 10),
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/settings`);
  revalidatePath(`/dashboard/${groupId}/contributions`);
  return { status: "success" };
}

export async function recordContributionAction(
  groupId: string,
  _prevState: ContributionActionState,
  formData: FormData,
): Promise<ContributionActionState> {
  const parsed = recordContributionSchema.safeParse({
    memberId: formData.get("memberId"),
    amountMajorUnits: formData.get("amountMajorUnits"),
    periodDate: formData.get("periodDate"),
    receivedAt: formData.get("receivedAt"),
    paymentMethod: formData.get("paymentMethod"),
    paymentReference: formData.get("paymentReference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const { data: plan } = await loadActivePlan(groupId);

  if (!plan) {
    return {
      status: "error",
      formError: "Set up a contribution plan in Settings before recording contributions.",
    };
  }

  const period = getPeriodContaining(
    plan.start_date,
    plan.frequency as ContributionFrequency,
    parsed.data.periodDate,
  );

  const { majorToMinorUnits } = await import("@/lib/money");
  const supabase = await createClient();

  const { error } = await supabase.rpc("record_contribution", {
    p_group_id: groupId,
    p_member_id: parsed.data.memberId,
    p_contribution_plan_id: plan.id,
    p_amount_minor_units: majorToMinorUnits(parsed.data.amountMajorUnits, plan.currency_code),
    p_period_start: period.start,
    p_period_end: period.end,
    p_received_at: parsed.data.receivedAt,
    p_payment_method: parsed.data.paymentMethod,
    p_payment_reference: parsed.data.paymentReference ?? null,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/contributions`);
  return { status: "success" };
}

export async function verifyContributionAction(
  groupId: string,
  recordId: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_contribution", { p_record_id: recordId });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/contributions`);
  return {};
}

export async function reconcileContributionAction(
  groupId: string,
  recordId: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reconcile_contribution", { p_record_id: recordId });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/contributions`);
  return {};
}

export async function rejectContributionAction(
  groupId: string,
  _prevState: ContributionActionState,
  formData: FormData,
): Promise<ContributionActionState> {
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });
  const recordId = String(formData.get("recordId") ?? "");

  if (!parsed.success || !recordId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_contribution", {
    p_record_id: recordId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/contributions`);
  return { status: "success" };
}

export async function reverseContributionAction(
  groupId: string,
  _prevState: ContributionActionState,
  formData: FormData,
): Promise<ContributionActionState> {
  const recordId = String(formData.get("recordId") ?? "");
  const parsed = reverseContributionSchema.safeParse({
    reason: formData.get("reason"),
    createReplacement: formData.get("createReplacement") ?? "false",
    amountMajorUnits: formData.get("amountMajorUnits") || undefined,
    periodDate: formData.get("periodDate") || undefined,
    receivedAt: formData.get("receivedAt") || undefined,
    paymentMethod: formData.get("paymentMethod") || undefined,
    paymentReference: formData.get("paymentReference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success || !recordId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  let replacement: Record<string, string | number> | null = null;

  if (parsed.data.createReplacement) {
    const { data: plan } = await loadActivePlan(groupId);
    const { majorToMinorUnits } = await import("@/lib/money");

    replacement = {};
    if (parsed.data.amountMajorUnits !== undefined && plan) {
      replacement.amount_minor_units = majorToMinorUnits(parsed.data.amountMajorUnits, plan.currency_code);
    }
    if (parsed.data.periodDate !== undefined && plan) {
      const period = getPeriodContaining(
        plan.start_date,
        plan.frequency as ContributionFrequency,
        parsed.data.periodDate,
      );
      replacement.period_start = period.start;
      replacement.period_end = period.end;
    }
    if (parsed.data.receivedAt !== undefined) replacement.received_at = parsed.data.receivedAt;
    if (parsed.data.paymentMethod !== undefined) {
      replacement.payment_method = parsed.data.paymentMethod satisfies PaymentMethod;
    }
    if (parsed.data.paymentReference !== undefined) replacement.payment_reference = parsed.data.paymentReference;
    if (parsed.data.notes !== undefined) replacement.notes = parsed.data.notes;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_contribution", {
    p_record_id: recordId,
    p_reason: parsed.data.reason,
    p_replacement: replacement,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/contributions`);
  return { status: "success" };
}
