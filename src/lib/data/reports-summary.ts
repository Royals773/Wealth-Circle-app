import { createClient } from "@/lib/supabase/server";
import {
  loadGroupContributionSummary,
  type GroupContributionSummary,
} from "@/lib/data/contribution-summary";
import { loadGroupLoanSummary, type GroupLoanSummary } from "@/lib/data/loan-summary";
import { loadGroupWithdrawalSummary, type GroupWithdrawalSummary } from "@/lib/data/withdrawal-summary";

/**
 * Group financial overview and specialist reports — all computed live
 * from RLS-scoped rows, reusing the same authoritative summary loaders
 * the dashboards already use (contribution-summary.ts, loan-summary.ts,
 * withdrawal-summary.ts) rather than recalculating totals a second way.
 * Nothing here is ever described as the group's confirmed bank balance —
 * WealthCircle records but never independently verifies the external
 * bank account (see docs/security-boundaries.md).
 */

export type TransactionType = "contribution" | "repayment" | "withdrawal";

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  memberId?: string;
  type?: TransactionType;
  status?: string;
  reconciliationState?: "reconciled" | "unreconciled";
}

export interface UnifiedTransactionRow {
  id: string;
  type: TransactionType;
  memberId: string;
  memberName: string;
  amountMinorUnits: number;
  currencyCode: string;
  status: string;
  date: string;
  reconciled: boolean;
  reversedOrCorrected: boolean;
}

const RECONCILED_STATUSES = new Set(["reconciled"]);
const REVERSED_STATUSES = new Set(["reversed", "rejected"]);

function matchesFilters(row: UnifiedTransactionRow, filters: ReportFilters): boolean {
  if (filters.dateFrom && row.date < filters.dateFrom) return false;
  if (filters.dateTo && row.date > filters.dateTo) return false;
  if (filters.memberId && row.memberId !== filters.memberId) return false;
  if (filters.type && row.type !== filters.type) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.reconciliationState === "reconciled" && !row.reconciled) return false;
  if (filters.reconciliationState === "unreconciled" && row.reconciled) return false;
  return true;
}

async function loadMemberNames(groupId: string): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("user_id")
    .eq("group_id", groupId);
  const ids = [...new Set((memberships ?? []).map((m) => m.user_id))];
  if (ids.length === 0) return new Map();

  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  return new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
}

async function loadUnifiedTransactions(groupId: string): Promise<UnifiedTransactionRow[]> {
  const supabase = await createClient();
  const names = await loadMemberNames(groupId);

  const [{ data: contributions }, { data: repayments }, { data: withdrawals }] = await Promise.all([
    supabase
      .from("contribution_records")
      .select("id, member_id, amount_minor_units, currency_code, status, received_at")
      .eq("group_id", groupId),
    supabase
      .from("repayments")
      .select("id, member_id, amount_minor_units, currency_code, status, received_at")
      .eq("group_id", groupId),
    supabase
      .from("withdrawal_requests")
      .select("id, requested_by, amount_minor_units, currency_code, status, created_at, payment_date")
      .eq("group_id", groupId),
  ]);

  const rows: UnifiedTransactionRow[] = [];

  for (const c of contributions ?? []) {
    rows.push({
      id: c.id,
      type: "contribution",
      memberId: c.member_id,
      memberName: names.get(c.member_id) ?? "Unknown member",
      amountMinorUnits: c.amount_minor_units,
      currencyCode: c.currency_code,
      status: c.status,
      date: c.received_at,
      reconciled: RECONCILED_STATUSES.has(c.status),
      reversedOrCorrected: REVERSED_STATUSES.has(c.status),
    });
  }

  for (const r of repayments ?? []) {
    rows.push({
      id: r.id,
      type: "repayment",
      memberId: r.member_id,
      memberName: names.get(r.member_id) ?? "Unknown member",
      amountMinorUnits: r.amount_minor_units,
      currencyCode: r.currency_code,
      status: r.status,
      date: r.received_at,
      reconciled: RECONCILED_STATUSES.has(r.status),
      reversedOrCorrected: REVERSED_STATUSES.has(r.status),
    });
  }

  for (const w of withdrawals ?? []) {
    rows.push({
      id: w.id,
      type: "withdrawal",
      memberId: w.requested_by,
      memberName: names.get(w.requested_by) ?? "Unknown member",
      amountMinorUnits: w.amount_minor_units,
      currencyCode: w.currency_code,
      status: w.status,
      date: w.payment_date ?? w.created_at.slice(0, 10),
      reconciled: w.status === "paid_externally",
      reversedOrCorrected: w.status === "reversed" || w.status === "rejected",
    });
  }

  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface GroupFinancialOverview {
  generatedAt: string;
  currencyCode: string;
  contributions: Pick<
    GroupContributionSummary,
    "expectedTotal" | "receivedTotal" | "verifiedTotal" | "pendingTotal" | "outstandingTotal" | "overdueMemberCount"
  >;
  loans: Pick<
    GroupLoanSummary,
    "principalOutstanding" | "interestExpected" | "interestReceived" | "activeLoanCount" | "overdueCount"
  >;
  withdrawals: Pick<
    GroupWithdrawalSummary,
    "totalPendingMinorUnits" | "totalPaidMinorUnits" | "awaitingReviewCount"
  >;
  reversedOrCorrectedCount: number;
  transactions: UnifiedTransactionRow[];
}

/** The group financial overview report — every number reused from the
 * same loaders the dashboards already call, so a report can never
 * disagree with what's shown on screen elsewhere. `transactions` is the
 * filtered detail list the CSV export and on-screen table both draw
 * from. */
export async function loadGroupFinancialOverview(
  groupId: string,
  filters: ReportFilters = {},
): Promise<GroupFinancialOverview> {
  const [contributionSummary, loanSummary, withdrawalSummary, allTransactions] = await Promise.all([
    loadGroupContributionSummary(groupId),
    loadGroupLoanSummary(groupId),
    loadGroupWithdrawalSummary(groupId),
    loadUnifiedTransactions(groupId),
  ]);

  const transactions = allTransactions.filter((row) => matchesFilters(row, filters));

  return {
    generatedAt: new Date().toISOString(),
    currencyCode: loanSummary.currencyCode || withdrawalSummary.currencyCode,
    contributions: {
      expectedTotal: contributionSummary.expectedTotal,
      receivedTotal: contributionSummary.receivedTotal,
      verifiedTotal: contributionSummary.verifiedTotal,
      pendingTotal: contributionSummary.pendingTotal,
      outstandingTotal: contributionSummary.outstandingTotal,
      overdueMemberCount: contributionSummary.overdueMemberCount,
    },
    loans: {
      principalOutstanding: loanSummary.principalOutstanding,
      interestExpected: loanSummary.interestExpected,
      interestReceived: loanSummary.interestReceived,
      activeLoanCount: loanSummary.activeLoanCount,
      overdueCount: loanSummary.overdueCount,
    },
    withdrawals: {
      totalPendingMinorUnits: withdrawalSummary.totalPendingMinorUnits,
      totalPaidMinorUnits: withdrawalSummary.totalPaidMinorUnits,
      awaitingReviewCount: withdrawalSummary.awaitingReviewCount,
    },
    reversedOrCorrectedCount: allTransactions.filter((r) => r.reversedOrCorrected).length,
    transactions,
  };
}

export interface ArrearsRow {
  memberId: string;
  memberName: string;
  overdueContribution: boolean;
  overdueRepaymentCount: number;
}

/** Contribution status and arrears report: which members currently
 * have an overdue contribution period, reusing the per-member status
 * rows the treasurer dashboard's monthly table already computes. */
export async function loadArrearsReport(groupId: string): Promise<ArrearsRow[]> {
  const summary = await loadGroupContributionSummary(groupId);
  const loanSummary = await loadGroupLoanSummary(groupId);

  const overdueRepaymentsByBorrower = new Map<string, number>();
  for (const loan of loanSummary.loanRows) {
    if (loan.displayStatus !== "overdue") continue;
    overdueRepaymentsByBorrower.set(
      loan.borrowerName,
      (overdueRepaymentsByBorrower.get(loan.borrowerName) ?? 0) + 1,
    );
  }

  return summary.memberStatuses
    .filter((m) => m.status === "overdue" || overdueRepaymentsByBorrower.has(m.memberName))
    .map((m) => ({
      memberId: m.memberId,
      memberName: m.memberName,
      overdueContribution: m.status === "overdue",
      overdueRepaymentCount: overdueRepaymentsByBorrower.get(m.memberName) ?? 0,
    }));
}

/** Reconciliation exceptions: verified-but-not-reconciled records —
 * the gap between "confirmed happened" and "matched against a bank
 * statement." */
export async function loadReconciliationExceptions(groupId: string): Promise<UnifiedTransactionRow[]> {
  const transactions = await loadUnifiedTransactions(groupId);
  return transactions.filter((row) => row.status === "verified" || row.status === "under_review");
}
