"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { flushPendingNotificationEmails } from "@/lib/actions/notifications";
import {
  recordBackdatedContributionSchema,
  bulkImportRowSchema,
  MAX_BULK_IMPORT_ROWS,
  type BulkImportRow,
} from "@/lib/validations/backdated-contributions";

export interface BackdatedContributionActionState {
  status: "idle" | "error" | "success" | "implausible_date";
  formError?: string;
  fieldErrors?: Record<string, string>;
}

export interface BulkImportRowResult {
  rowIndex: number;
  success: boolean;
  recordId: string | null;
  memberIdentifier: string;
  isBackdated: boolean | null;
  errorMessage: string | null;
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

async function loadGroupCurrency(groupId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("groups").select("currency_code").eq("id", groupId).single();
  return data?.currency_code ?? null;
}

export async function recordBackdatedContributionAction(
  groupId: string,
  _prevState: BackdatedContributionActionState,
  formData: FormData,
): Promise<BackdatedContributionActionState> {
  const parsed = recordBackdatedContributionSchema.safeParse({
    groupId,
    memberId: formData.get("memberId"),
    amountMajorUnits: formData.get("amountMajorUnits"),
    receivedAt: formData.get("receivedAt"),
    note: formData.get("note") || undefined,
    confirmImplausibleDate: formData.get("confirmImplausibleDate") || undefined,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const currencyCode = await loadGroupCurrency(groupId);
  if (!currencyCode) {
    return { status: "error", formError: "Group not found" };
  }

  const { majorToMinorUnits } = await import("@/lib/money");
  const supabase = await createClient();

  const { error } = await supabase.rpc("record_backdated_contribution", {
    p_group_id: groupId,
    p_member_id: parsed.data.memberId,
    p_amount_minor_units: majorToMinorUnits(parsed.data.amountMajorUnits, currencyCode),
    p_received_at: parsed.data.receivedAt,
    p_note: parsed.data.note || null,
    p_confirm_implausible_date: parsed.data.confirmImplausibleDate,
  });

  if (error) {
    if (error.message.startsWith("IMPLAUSIBLE_DATE:")) {
      return { status: "implausible_date", formError: error.message.replace(/^IMPLAUSIBLE_DATE:\s*/, "") };
    }
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/contributions`);
  await flushPendingNotificationEmails();
  return { status: "success" };
}

/**
 * Shared by preview (dry run) and commit — the RPC itself takes the
 * dry-run flag, so both calls run the exact same validation and can
 * never disagree about what would happen.
 */
async function runBulkImport(
  groupId: string,
  rows: BulkImportRow[],
  confirmImplausibleDates: boolean,
  dryRun: boolean,
): Promise<{ results: BulkImportRowResult[] } | { error: string }> {
  if (!isSupabaseConfigured) {
    return { error: NOT_CONFIGURED_MESSAGE };
  }
  if (rows.length === 0) {
    return { error: "The import file has no rows" };
  }
  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    return { error: `This import has ${rows.length} rows — the limit is ${MAX_BULK_IMPORT_ROWS} per file` };
  }

  for (const row of rows) {
    const parsed = bulkImportRowSchema.safeParse(row);
    if (!parsed.success) {
      return { error: `Malformed row for "${row.memberIdentifier || "(blank)"}": ${parsed.error.issues[0]?.message}` };
    }
  }

  const currencyCode = await loadGroupCurrency(groupId);
  if (!currencyCode) {
    return { error: "Group not found" };
  }

  const { majorToMinorUnits } = await import("@/lib/money");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("bulk_import_contributions", {
    p_group_id: groupId,
    p_rows: rows.map((row) => ({
      member_identifier: row.memberIdentifier,
      amount_minor_units: majorToMinorUnits(row.amountMajorUnits, currencyCode),
      received_at: row.receivedAt,
      note: row.note || null,
    })),
    p_confirm_implausible_dates: confirmImplausibleDates,
    p_dry_run: dryRun,
  });

  if (error) {
    return { error: error.message };
  }

  const results: BulkImportRowResult[] = (data ?? []).map((r) => ({
    rowIndex: r.row_index,
    success: r.success,
    recordId: r.record_id,
    memberIdentifier: r.member_identifier,
    isBackdated: r.is_backdated,
    errorMessage: r.error_message,
  }));

  return { results };
}

export async function previewBulkImportAction(
  groupId: string,
  rows: BulkImportRow[],
  confirmImplausibleDates: boolean,
) {
  return runBulkImport(groupId, rows, confirmImplausibleDates, true);
}

export async function commitBulkImportAction(
  groupId: string,
  rows: BulkImportRow[],
  confirmImplausibleDates: boolean,
) {
  const result = await runBulkImport(groupId, rows, confirmImplausibleDates, false);
  if (!("error" in result) && result.results.some((r) => r.success)) {
    revalidatePath(`/dashboard/${groupId}/contributions`);
    await flushPendingNotificationEmails();
  }
  return result;
}

export async function confirmBackdatedContributionAction(
  groupId: string,
  recordId: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_backdated_contribution", { p_record_id: recordId });
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/contributions`);
  return {};
}
