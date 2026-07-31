import { describe, expect, it } from "vitest";
import {
  computeAvailableWithdrawalAmount,
  computeWithdrawalEligibility,
  validateWithdrawalAmount,
  type WithdrawalPolicyForEligibility,
} from "./withdrawals";

const basePolicy: WithdrawalPolicyForEligibility = {
  enabled: true,
  minAmountMinorUnits: null,
  maxAmountMinorUnits: null,
  allowPartial: true,
  allowOverdueMembers: false,
  blockMembersWithActiveLoans: false,
  largeWithdrawalThresholdMinorUnits: null,
};

describe("computeAvailableWithdrawalAmount", () => {
  it("is verified contributions minus outstanding loan principal minus reserved amounts", () => {
    expect(
      computeAvailableWithdrawalAmount({
        verifiedContributionsTotal: 100_000,
        outstandingLoanPrincipal: 20_000,
        reservedAmount: 10_000,
      }),
    ).toBe(70_000);
  });

  it("never goes negative", () => {
    expect(
      computeAvailableWithdrawalAmount({
        verifiedContributionsTotal: 10_000,
        outstandingLoanPrincipal: 50_000,
        reservedAmount: 0,
      }),
    ).toBe(0);
  });
});

describe("computeWithdrawalEligibility", () => {
  it("is eligible with a healthy balance and no blocking conditions", () => {
    const result = computeWithdrawalEligibility({
      verifiedContributionsTotal: 100_000,
      outstandingLoanPrincipal: 0,
      reservedAmount: 0,
      hasActiveLoan: false,
      hasOverdueContributions: false,
      policy: basePolicy,
      membershipStatus: "active",
    });
    expect(result.eligible).toBe(true);
    expect(result.availableToWithdraw).toBe(100_000);
  });

  it("is ineligible when withdrawals are disabled", () => {
    const result = computeWithdrawalEligibility({
      verifiedContributionsTotal: 100_000,
      outstandingLoanPrincipal: 0,
      reservedAmount: 0,
      hasActiveLoan: false,
      hasOverdueContributions: false,
      policy: { ...basePolicy, enabled: false },
      membershipStatus: "active",
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Withdrawals are not currently enabled for this group.");
  });

  it("is ineligible for a non-active membership", () => {
    const result = computeWithdrawalEligibility({
      verifiedContributionsTotal: 100_000,
      outstandingLoanPrincipal: 0,
      reservedAmount: 0,
      hasActiveLoan: false,
      hasOverdueContributions: false,
      policy: basePolicy,
      membershipStatus: "suspended",
    });
    expect(result.eligible).toBe(false);
  });

  it("blocks members with an active loan only when the policy says so", () => {
    const blocked = computeWithdrawalEligibility({
      verifiedContributionsTotal: 100_000,
      outstandingLoanPrincipal: 10_000,
      reservedAmount: 0,
      hasActiveLoan: true,
      hasOverdueContributions: false,
      policy: { ...basePolicy, blockMembersWithActiveLoans: true },
      membershipStatus: "active",
    });
    expect(blocked.eligible).toBe(false);

    const allowed = computeWithdrawalEligibility({
      verifiedContributionsTotal: 100_000,
      outstandingLoanPrincipal: 10_000,
      reservedAmount: 0,
      hasActiveLoan: true,
      hasOverdueContributions: false,
      policy: basePolicy,
      membershipStatus: "active",
    });
    expect(allowed.eligible).toBe(true);
    // The loan-protection rule still reduces the available amount even
    // when the group doesn't block active-loan members outright.
    expect(allowed.availableToWithdraw).toBe(90_000);
  });

  it("blocks overdue members unless the policy explicitly allows them", () => {
    const blocked = computeWithdrawalEligibility({
      verifiedContributionsTotal: 100_000,
      outstandingLoanPrincipal: 0,
      reservedAmount: 0,
      hasActiveLoan: false,
      hasOverdueContributions: true,
      policy: basePolicy,
      membershipStatus: "active",
    });
    expect(blocked.eligible).toBe(false);

    const allowed = computeWithdrawalEligibility({
      verifiedContributionsTotal: 100_000,
      outstandingLoanPrincipal: 0,
      reservedAmount: 0,
      hasActiveLoan: false,
      hasOverdueContributions: true,
      policy: { ...basePolicy, allowOverdueMembers: true },
      membershipStatus: "active",
    });
    expect(allowed.eligible).toBe(true);
  });

  it("a zero available balance is its own reason when nothing else is blocking", () => {
    const result = computeWithdrawalEligibility({
      verifiedContributionsTotal: 10_000,
      outstandingLoanPrincipal: 10_000,
      reservedAmount: 0,
      hasActiveLoan: true,
      hasOverdueContributions: false,
      policy: basePolicy,
      membershipStatus: "active",
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["No balance available to withdraw right now."]);
  });

  it("outstanding loan principal never lets net verified contributions go negative in the calc", () => {
    // The safest-default rule: available is floored at 0, so the loan
    // protection can never be circumvented by a member with more debt
    // than contributions.
    const result = computeWithdrawalEligibility({
      verifiedContributionsTotal: 5_000,
      outstandingLoanPrincipal: 20_000,
      reservedAmount: 0,
      hasActiveLoan: true,
      hasOverdueContributions: false,
      policy: basePolicy,
      membershipStatus: "active",
    });
    expect(result.availableToWithdraw).toBe(0);
  });
});

describe("validateWithdrawalAmount", () => {
  it("rejects a zero or negative amount", () => {
    expect(validateWithdrawalAmount(0, 100_000, basePolicy, false).valid).toBe(false);
    expect(validateWithdrawalAmount(-1, 100_000, basePolicy, false).valid).toBe(false);
  });

  it("rejects an amount exceeding the available balance", () => {
    const result = validateWithdrawalAmount(60_000, 50_000, basePolicy, false);
    expect(result.valid).toBe(false);
  });

  it("enforces the policy minimum and maximum", () => {
    const policy = { ...basePolicy, minAmountMinorUnits: 5_000, maxAmountMinorUnits: 50_000 };
    expect(validateWithdrawalAmount(1_000, 100_000, policy, false).valid).toBe(false);
    expect(validateWithdrawalAmount(60_000, 100_000, policy, false).valid).toBe(false);
    expect(validateWithdrawalAmount(10_000, 100_000, policy, false).valid).toBe(true);
  });

  it("requires the full available balance when partial withdrawals are disallowed", () => {
    const policy = { ...basePolicy, allowPartial: false };
    expect(validateWithdrawalAmount(50_000, 100_000, policy, false).valid).toBe(false);
    expect(validateWithdrawalAmount(100_000, 100_000, policy, false).valid).toBe(true);
  });

  it("requires a linked proposal once the amount reaches the large-withdrawal threshold", () => {
    const policy = { ...basePolicy, largeWithdrawalThresholdMinorUnits: 50_000 };
    expect(validateWithdrawalAmount(60_000, 100_000, policy, false).valid).toBe(false);
    expect(validateWithdrawalAmount(60_000, 100_000, policy, true).valid).toBe(true);
    // Below the threshold, no proposal is required.
    expect(validateWithdrawalAmount(40_000, 100_000, policy, false).valid).toBe(true);
  });
});
