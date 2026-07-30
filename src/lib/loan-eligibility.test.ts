import { describe, expect, it } from "vitest";
import { computeEligibility, type LoanPolicyForEligibility } from "./loan-eligibility";

const basePolicy: LoanPolicyForEligibility = {
  enabled: true,
  maxLoanBpsOfContributions: 9500, // 95%
  maxAmountMinorUnits: null,
  allowOverdueMembers: false,
};

describe("computeEligibility", () => {
  it("caps the loan at the configured percentage of verified contributions", () => {
    const result = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 0,
      policy: basePolicy,
      membershipStatus: "active",
      hasOverdueContributions: false,
      hasOverdueRepayments: false,
    });
    expect(result.maxLoanAmount).toBe(95_000);
    expect(result.availableToBorrow).toBe(95_000);
    expect(result.eligible).toBe(true);
  });

  it("reduces available borrowing capacity by existing outstanding principal", () => {
    const result = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 60_000,
      policy: basePolicy,
      membershipStatus: "active",
      hasOverdueContributions: false,
      hasOverdueRepayments: false,
    });
    expect(result.maxLoanAmount).toBe(95_000);
    expect(result.availableToBorrow).toBe(35_000);
  });

  it("never goes negative when outstanding principal exceeds the cap", () => {
    const result = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 200_000,
      policy: basePolicy,
      membershipStatus: "active",
      hasOverdueContributions: false,
      hasOverdueRepayments: false,
    });
    expect(result.availableToBorrow).toBe(0);
    expect(result.eligible).toBe(false);
  });

  it("applies an optional hard ceiling independent of the percentage calculation", () => {
    const result = computeEligibility({
      verifiedContributionsTotal: 1_000_000,
      existingOutstandingPrincipal: 0,
      policy: { ...basePolicy, maxAmountMinorUnits: 50_000 },
      membershipStatus: "active",
      hasOverdueContributions: false,
      hasOverdueRepayments: false,
    });
    expect(result.maxLoanAmount).toBe(50_000);
  });

  it("is ineligible when the policy is disabled", () => {
    const result = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 0,
      policy: { ...basePolicy, enabled: false },
      membershipStatus: "active",
      hasOverdueContributions: false,
      hasOverdueRepayments: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("Loans are not currently enabled for this group.");
  });

  it("is ineligible for a non-active membership", () => {
    const result = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 0,
      policy: basePolicy,
      membershipStatus: "suspended",
      hasOverdueContributions: false,
      hasOverdueRepayments: false,
    });
    expect(result.eligible).toBe(false);
  });

  it("blocks overdue members unless the policy explicitly allows them", () => {
    const blocked = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 0,
      policy: basePolicy,
      membershipStatus: "active",
      hasOverdueContributions: true,
      hasOverdueRepayments: false,
    });
    expect(blocked.eligible).toBe(false);

    const allowed = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 0,
      policy: { ...basePolicy, allowOverdueMembers: true },
      membershipStatus: "active",
      hasOverdueContributions: true,
      hasOverdueRepayments: false,
    });
    expect(allowed.eligible).toBe(true);
  });

  it("blocks on overdue repayments the same way as overdue contributions", () => {
    const result = computeEligibility({
      verifiedContributionsTotal: 100_000,
      existingOutstandingPrincipal: 0,
      policy: basePolicy,
      membershipStatus: "active",
      hasOverdueContributions: false,
      hasOverdueRepayments: true,
    });
    expect(result.eligible).toBe(false);
  });

  it("pending, rejected or reversed contributions must not increase eligibility (caller contract)", () => {
    // computeEligibility only ever receives verifiedContributionsTotal —
    // there is no field for pending/rejected/reversed amounts at all, so
    // they structurally cannot influence the result. Demonstrated here
    // by confirming the max is driven purely by the verified figure.
    const result = computeEligibility({
      verifiedContributionsTotal: 10_000,
      existingOutstandingPrincipal: 0,
      policy: basePolicy,
      membershipStatus: "active",
      hasOverdueContributions: false,
      hasOverdueRepayments: false,
    });
    expect(result.maxLoanAmount).toBe(9_500);
  });
});
