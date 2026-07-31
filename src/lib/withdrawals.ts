/**
 * Withdrawal balance and eligibility calculation. Pure and unit-tested;
 * the real enforcement happens server-side inside request_withdrawal()
 * and decide_withdrawal_request() (SQL can't call TypeScript, so the
 * same formula is mirrored there) — this module drives the
 * member-facing "here's what you can withdraw" display, computed from
 * RLS-scoped verified ledger data, never from anything the client sends.
 */

export interface WithdrawalPolicyForEligibility {
  enabled: boolean;
  minAmountMinorUnits: number | null;
  maxAmountMinorUnits: number | null;
  allowPartial: boolean;
  allowOverdueMembers: boolean;
  blockMembersWithActiveLoans: boolean;
  largeWithdrawalThresholdMinorUnits: number | null;
}

export interface WithdrawalEligibilityInput {
  verifiedContributionsTotal: number;
  outstandingLoanPrincipal: number;
  reservedAmount: number;
  hasActiveLoan: boolean;
  hasOverdueContributions: boolean;
  policy: WithdrawalPolicyForEligibility;
  membershipStatus: "active" | "suspended" | "removed";
}

export interface WithdrawalEligibilityResult {
  eligible: boolean;
  /** max(0, verified contributions − outstanding loan principal −
   * amounts already reserved by open requests). The safest-default
   * loan-protection rule: a withdrawal can never leave a member's net
   * verified contributions below their outstanding loan principal. */
  availableToWithdraw: number;
  reasons: string[];
}

/** The withdrawal-balance calculation itself, isolated from the
 * eligibility gates below — used directly for the "available amount"
 * stat even when the member is otherwise ineligible (e.g. still shown
 * as £0 available is more honest than hiding the number entirely). */
export function computeAvailableWithdrawalAmount(input: {
  verifiedContributionsTotal: number;
  outstandingLoanPrincipal: number;
  reservedAmount: number;
}): number {
  return Math.max(
    0,
    input.verifiedContributionsTotal - input.outstandingLoanPrincipal - input.reservedAmount,
  );
}

export function computeWithdrawalEligibility(
  input: WithdrawalEligibilityInput,
): WithdrawalEligibilityResult {
  const reasons: string[] = [];

  if (!input.policy.enabled) {
    reasons.push("Withdrawals are not currently enabled for this group.");
  }
  if (input.membershipStatus !== "active") {
    reasons.push("Only active members can request a withdrawal.");
  }
  if (input.policy.blockMembersWithActiveLoans && input.hasActiveLoan) {
    reasons.push("Members with an active loan cannot request a withdrawal under this group's policy.");
  }
  if (!input.policy.allowOverdueMembers && input.hasOverdueContributions) {
    reasons.push("Overdue contributions must be resolved before requesting a withdrawal.");
  }

  const availableToWithdraw = computeAvailableWithdrawalAmount({
    verifiedContributionsTotal: input.verifiedContributionsTotal,
    outstandingLoanPrincipal: input.outstandingLoanPrincipal,
    reservedAmount: input.reservedAmount,
  });

  if (availableToWithdraw <= 0 && reasons.length === 0) {
    reasons.push("No balance available to withdraw right now.");
  }

  return {
    eligible: reasons.length === 0,
    availableToWithdraw,
    reasons,
  };
}

export interface WithdrawalAmountValidationResult {
  valid: boolean;
  reason: string | null;
}

/** Validates a specific requested amount against the policy's min/max/
 * partial-withdrawal rules and the large-withdrawal governance-link
 * requirement — the client-side preview of exactly what
 * request_withdrawal() will itself enforce. */
export function validateWithdrawalAmount(
  amountMinorUnits: number,
  availableToWithdraw: number,
  policy: WithdrawalPolicyForEligibility,
  hasLinkedProposal: boolean,
): WithdrawalAmountValidationResult {
  if (amountMinorUnits <= 0) {
    return { valid: false, reason: "Enter an amount greater than zero." };
  }
  if (amountMinorUnits > availableToWithdraw) {
    return { valid: false, reason: "This amount exceeds your available balance." };
  }
  if (policy.minAmountMinorUnits !== null && amountMinorUnits < policy.minAmountMinorUnits) {
    return { valid: false, reason: "This amount is below the group's minimum withdrawal." };
  }
  if (policy.maxAmountMinorUnits !== null && amountMinorUnits > policy.maxAmountMinorUnits) {
    return { valid: false, reason: "This amount exceeds the group's maximum withdrawal." };
  }
  if (!policy.allowPartial && amountMinorUnits < availableToWithdraw) {
    return { valid: false, reason: "This group only permits withdrawing your full available balance." };
  }
  if (
    policy.largeWithdrawalThresholdMinorUnits !== null &&
    amountMinorUnits >= policy.largeWithdrawalThresholdMinorUnits &&
    !hasLinkedProposal
  ) {
    return {
      valid: false,
      reason: "This amount requires linking a governance proposal that must pass before it can be approved.",
    };
  }
  return { valid: true, reason: null };
}
