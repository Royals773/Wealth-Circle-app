import type { Period } from "@/lib/contribution-periods";
import type { ContributionRecordStatus } from "@/lib/types/database";

/**
 * Status/aggregation logic for the contribution ledger. Every function
 * here is pure — dates and "today" are always passed in as plain
 * `YYYY-MM-DD` strings, never read from the system clock — so results are
 * deterministic and this is where "member balances and group totals must
 * be calculated server-side" actually happens (called from Server
 * Components against RLS-scoped query results, never from the browser).
 */

export interface ContributionAmountRow {
  status: ContributionRecordStatus;
  amount_minor_units: number;
}

/** Only `verified` and `reconciled` rows count toward a total —
 * `pending_verification`, `rejected` and `reversed` rows are excluded, so
 * a reversed contribution never contributes to a member's paid amount. */
export function sumVerifiedAmount(records: ContributionAmountRow[]): number {
  return records
    .filter((record) => record.status === "verified" || record.status === "reconciled")
    .reduce((total, record) => total + record.amount_minor_units, 0);
}

export interface ContributionPlanTarget {
  isFlexible: boolean;
  amountMinorUnits: number | null;
  minimumAmountMinorUnits: number | null;
}

export type MemberPeriodStatus = "paid" | "partial" | "unpaid" | "overdue" | "not_applicable";

/** The required amount for a period, or null if the plan has no fixed
 * requirement (a flexible plan with no minimum defined). */
export function requiredAmountForPeriod(plan: ContributionPlanTarget): number | null {
  if (!plan.isFlexible) return plan.amountMinorUnits;
  return plan.minimumAmountMinorUnits;
}

export function computeMemberPeriodStatus(params: {
  plan: ContributionPlanTarget;
  period: Period;
  verifiedTotal: number;
  today: string;
  memberJoinedAt: string;
}): MemberPeriodStatus {
  const { plan, period, verifiedTotal, today, memberJoinedAt } = params;

  // A flexible plan with no defined minimum has nothing to be "overdue"
  // against — per the spec, never label it that way.
  const required = requiredAmountForPeriod(plan);
  if (required === null) return "not_applicable";

  // The member wasn't a member yet when this period ended.
  if (memberJoinedAt > period.end) return "not_applicable";

  if (verifiedTotal >= required) return "paid";

  const isPastDue = today > period.end;

  if (isPastDue) return "overdue";

  return verifiedTotal > 0 ? "partial" : "unpaid";
}
