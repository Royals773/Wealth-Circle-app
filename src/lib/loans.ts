import { addDaysISO, addMonths, listPeriodsBetween } from "@/lib/contribution-periods";
import { sumVerifiedAmount, type ContributionAmountRow } from "@/lib/contributions";
import type { ContributionFrequency } from "@/lib/types/database";

/**
 * Loan schedule, status and money math. Pure and unit-tested, same
 * philosophy as src/lib/contributions.ts: dates are plain `YYYY-MM-DD`
 * strings, "today" is always passed in rather than read from the system
 * clock, and nothing here is trusted from the client — every caller runs
 * this server-side against RLS-scoped rows.
 */

/** One-time flat interest: a fixed percentage of principal, charged once,
 * never compounding. bps = basis points (1/100th of a percent), the same
 * exact-integer convention `loan_products.interest_rate_bps` already
 * uses — never a float. */
export function computeOneTimeFlatInterest(principalMinorUnits: number, interestRateBps: number): number {
  return Math.round((principalMinorUnits * interestRateBps) / 10_000);
}

/** Splits a single repayment between principal and interest in the same
 * ratio as the loan's overall principal:total-repayable ratio (e.g. a
 * £1,000 loan with £50 interest splits every payment 1000:1050
 * principal, 50:1050 interest). Interest gets the remainder rather than
 * its own rounded share, so the two portions always sum to exactly the
 * payment amount — no rounding drift, no float. */
export function computeProportionalAllocation(
  paymentAmountMinorUnits: number,
  principalMinorUnits: number,
  totalRepayableMinorUnits: number,
): { principalPortion: number; interestPortion: number } {
  const principalPortion = Math.floor((paymentAmountMinorUnits * principalMinorUnits) / totalRepayableMinorUnits);
  return {
    principalPortion,
    interestPortion: paymentAmountMinorUnits - principalPortion,
  };
}

export interface Instalment {
  index: number;
  dueDate: string;
  amountMinorUnits: number;
}

/** Generates instalment due dates by walking the repayment frequency's
 * periods from disbursement until the term (in months) ends, using the
 * same period primitives contribution plans use — the last instalment's
 * due date is clamped to exactly disbursementDate + termMonths even if
 * that falls mid-period, so the schedule always ends exactly on term.
 * `totalRepayableMinorUnits` is divided evenly across instalments, with
 * any remainder (from integer division) added to the final instalment
 * so the schedule always sums to exactly the total — never a float. */
export function computeLoanRepaymentSchedule(params: {
  disbursementDate: string;
  termMonths: number;
  frequency: ContributionFrequency;
  totalRepayableMinorUnits: number;
}): Instalment[] {
  const { disbursementDate, termMonths, frequency, totalRepayableMinorUnits } = params;
  const endDate = addMonths(disbursementDate, termMonths);
  // Search up to the day *before* the term ends, not endDate itself —
  // otherwise a term boundary that lands exactly on a period-start would
  // pull in that next period as a spurious extra, near-zero-length final
  // instalment (getPeriodIndexContaining treats a target equal to a
  // period's start as belonging to that period).
  const periods = listPeriodsBetween(disbursementDate, frequency, disbursementDate, addDaysISO(endDate, -1));

  const dueDates: string[] = [];
  for (const period of periods) {
    const dueDate = period.end > endDate ? endDate : period.end;
    if (dueDates[dueDates.length - 1] !== dueDate) dueDates.push(dueDate);
  }
  if (dueDates.length === 0) dueDates.push(endDate);

  const count = dueDates.length;
  const base = Math.floor(totalRepayableMinorUnits / count);
  const remainder = totalRepayableMinorUnits - base * count;

  return dueDates.map((dueDate, index) => ({
    index,
    dueDate,
    amountMinorUnits: base + (index === count - 1 ? remainder : 0),
  }));
}

export type LoanDisplayStatus = "awaiting_disbursement" | "active" | "overdue" | "fully_repaid" | "defaulted" | "cancelled";

/** The loan's real, current status for display — derived from the
 * schedule and verified repayments rather than a stored flag, so it can
 * never go stale (same reasoning as `computeMemberPeriodStatus` in
 * contributions.ts). `storedStatus` is `loans.status` as written by the
 * disbursement/default/cancel RPCs; everything past "active" is
 * computed here. */
export function computeLoanStatus(params: {
  storedStatus: "awaiting_disbursement" | "active" | "defaulted" | "cancelled";
  schedule: Instalment[];
  verifiedRepaidMinorUnits: number;
  totalRepayableMinorUnits: number;
  today: string;
  gracePeriodDays: number;
}): LoanDisplayStatus {
  const { storedStatus, schedule, verifiedRepaidMinorUnits, totalRepayableMinorUnits, today, gracePeriodDays } =
    params;

  if (storedStatus !== "active") return storedStatus;
  if (verifiedRepaidMinorUnits >= totalRepayableMinorUnits) return "fully_repaid";

  const cumulativeExpected = schedule
    .filter((instalment) => addDaysISO(instalment.dueDate, gracePeriodDays) < today)
    .reduce((sum, instalment) => sum + instalment.amountMinorUnits, 0);

  return verifiedRepaidMinorUnits < cumulativeExpected ? "overdue" : "active";
}

/** Only verified/reconciled repayments count — reuses the exact same
 * filter contributions.ts already established (a rejected or reversed
 * repayment must not reduce the outstanding balance). */
export function sumVerifiedRepayments(records: ContributionAmountRow[]): number {
  return sumVerifiedAmount(records);
}

/** Principal still owed on one loan: the original principal minus the
 * principal portion of every verified/reconciled repayment against it. */
export function outstandingPrincipal(
  principalMinorUnits: number,
  repayments: { status: string; principal_portion_minor_units: number }[],
): number {
  const verifiedPrincipal = repayments
    .filter((r) => r.status === "verified" || r.status === "reconciled")
    .reduce((sum, r) => sum + r.principal_portion_minor_units, 0);
  return Math.max(0, principalMinorUnits - verifiedPrincipal);
}
