/**
 * Loan eligibility and borrowing-limit calculation. Pure and
 * unit-tested; the real enforcement happens server-side inside the
 * apply_for_loan() RPC (SQL can't call TypeScript, so the same formula
 * is mirrored there) — this module drives the member-facing "here's
 * your maximum" display before submission, computed from RLS-scoped
 * verified ledger data, never from anything the client sends.
 */

export interface LoanPolicyForEligibility {
  enabled: boolean;
  maxLoanBpsOfContributions: number;
  maxAmountMinorUnits: number | null;
  allowOverdueMembers: boolean;
}

export interface EligibilityInput {
  verifiedContributionsTotal: number;
  existingOutstandingPrincipal: number;
  policy: LoanPolicyForEligibility;
  membershipStatus: "active" | "suspended" | "removed";
  hasOverdueContributions: boolean;
  hasOverdueRepayments: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  /** The borrowing ceiling from contributions/policy, before subtracting
   * any existing outstanding principal. */
  maxLoanAmount: number;
  /** What's actually left to borrow right now, after existing
   * outstanding principal is subtracted — this is the number a member
   * should see and the number apply_for_loan() enforces. */
  availableToBorrow: number;
  reasons: string[];
}

export function computeEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: string[] = [];

  if (!input.policy.enabled) {
    reasons.push("Loans are not currently enabled for this group.");
  }
  if (input.membershipStatus !== "active") {
    reasons.push("Only active members can apply for a loan.");
  }
  if (!input.policy.allowOverdueMembers) {
    if (input.hasOverdueContributions) {
      reasons.push("Overdue contributions must be resolved before applying for a loan.");
    }
    if (input.hasOverdueRepayments) {
      reasons.push("Overdue loan repayments must be resolved before applying for another loan.");
    }
  }

  const percentBasedMax = Math.floor(
    (input.verifiedContributionsTotal * input.policy.maxLoanBpsOfContributions) / 10_000,
  );
  const maxLoanAmount =
    input.policy.maxAmountMinorUnits !== null
      ? Math.min(percentBasedMax, input.policy.maxAmountMinorUnits)
      : percentBasedMax;

  const availableToBorrow = Math.max(0, maxLoanAmount - input.existingOutstandingPrincipal);

  if (availableToBorrow <= 0 && reasons.length === 0) {
    reasons.push(
      "No borrowing capacity available right now — increase verified contributions or repay existing loans first.",
    );
  }

  return {
    eligible: reasons.length === 0,
    maxLoanAmount,
    availableToBorrow,
    reasons,
  };
}
