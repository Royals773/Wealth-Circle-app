import { describe, expect, it } from "vitest";
import {
  computeLoanRepaymentSchedule,
  computeLoanStatus,
  computeOneTimeFlatInterest,
  computeProportionalAllocation,
  outstandingPrincipal,
  sumVerifiedRepayments,
} from "./loans";

describe("computeOneTimeFlatInterest", () => {
  it("matches the documented example: a £1,000 loan at 5% produces £50 interest", () => {
    expect(computeOneTimeFlatInterest(100_000, 500)).toBe(5_000);
  });

  it("rounds to the nearest minor unit rather than truncating", () => {
    // 333 * 1.5% = 4.995, rounds up to 5.
    expect(computeOneTimeFlatInterest(333, 150)).toBe(5);
  });
});

describe("computeProportionalAllocation", () => {
  const principal = 100_000;
  const totalRepayable = 105_000; // principal + £50 interest

  it("splits an even instalment in the loan's principal:interest ratio", () => {
    const { principalPortion, interestPortion } = computeProportionalAllocation(10_500, principal, totalRepayable);
    expect(principalPortion).toBe(10_000);
    expect(interestPortion).toBe(500);
    expect(principalPortion + interestPortion).toBe(10_500);
  });

  it("always sums exactly to the payment amount, even with rounding", () => {
    const { principalPortion, interestPortion } = computeProportionalAllocation(1_000, principal, totalRepayable);
    expect(principalPortion + interestPortion).toBe(1_000);
  });

  it("allocates a full final payment as exactly principal + interest", () => {
    const { principalPortion, interestPortion } = computeProportionalAllocation(
      totalRepayable,
      principal,
      totalRepayable,
    );
    expect(principalPortion).toBe(principal);
    expect(interestPortion).toBe(totalRepayable - principal);
  });
});

describe("computeLoanRepaymentSchedule", () => {
  it("produces exactly one instalment per month for a monthly, whole-month term", () => {
    const schedule = computeLoanRepaymentSchedule({
      disbursementDate: "2026-01-15",
      termMonths: 3,
      frequency: "monthly",
      totalRepayableMinorUnits: 105_000,
    });
    expect(schedule.map((i) => i.dueDate)).toEqual(["2026-02-14", "2026-03-14", "2026-04-14"]);
    expect(schedule.map((i) => i.amountMinorUnits)).toEqual([35_000, 35_000, 35_000]);
  });

  it("does not produce a spurious extra instalment when the term lands exactly on a period boundary", () => {
    // This is the exact off-by-one this function guards against: a term
    // ending precisely at the start of what would be the next period.
    const schedule = computeLoanRepaymentSchedule({
      disbursementDate: "2026-01-01",
      termMonths: 2,
      frequency: "monthly",
      totalRepayableMinorUnits: 20_000,
    });
    expect(schedule).toHaveLength(2);
  });

  it("puts any rounding remainder on the final instalment so the total is always exact", () => {
    const schedule = computeLoanRepaymentSchedule({
      disbursementDate: "2026-01-01",
      termMonths: 3,
      frequency: "monthly",
      totalRepayableMinorUnits: 10_000, // not evenly divisible by 3
    });
    const total = schedule.reduce((sum, i) => sum + i.amountMinorUnits, 0);
    expect(total).toBe(10_000);
    expect(schedule[0].amountMinorUnits).toBe(3_333);
    expect(schedule[1].amountMinorUnits).toBe(3_333);
    expect(schedule[2].amountMinorUnits).toBe(3_334);
  });

  it("clamps the final instalment's due date to exactly the term end for a weekly frequency", () => {
    const schedule = computeLoanRepaymentSchedule({
      disbursementDate: "2026-01-01",
      termMonths: 1,
      frequency: "weekly",
      totalRepayableMinorUnits: 5_000,
    });
    expect(schedule[schedule.length - 1].dueDate).toBe("2026-02-01");
  });
});

describe("computeLoanStatus", () => {
  const schedule = [
    { index: 0, dueDate: "2026-02-14", amountMinorUnits: 35_000 },
    { index: 1, dueDate: "2026-03-14", amountMinorUnits: 35_000 },
    { index: 2, dueDate: "2026-04-14", amountMinorUnits: 35_000 },
  ];
  const totalRepayableMinorUnits = 105_000;

  it("passes through non-active stored statuses unchanged", () => {
    expect(
      computeLoanStatus({
        storedStatus: "awaiting_disbursement",
        schedule,
        verifiedRepaidMinorUnits: 0,
        totalRepayableMinorUnits,
        today: "2026-06-01",
        gracePeriodDays: 0,
      }),
    ).toBe("awaiting_disbursement");

    expect(
      computeLoanStatus({
        storedStatus: "defaulted",
        schedule,
        verifiedRepaidMinorUnits: 0,
        totalRepayableMinorUnits,
        today: "2026-06-01",
        gracePeriodDays: 0,
      }),
    ).toBe("defaulted");
  });

  it("is fully_repaid once verified repayments meet or exceed the total, regardless of the schedule", () => {
    expect(
      computeLoanStatus({
        storedStatus: "active",
        schedule,
        verifiedRepaidMinorUnits: 105_000,
        totalRepayableMinorUnits,
        today: "2026-02-01",
        gracePeriodDays: 0,
      }),
    ).toBe("fully_repaid");
  });

  it("is active before anything is due, even with nothing paid", () => {
    expect(
      computeLoanStatus({
        storedStatus: "active",
        schedule,
        verifiedRepaidMinorUnits: 0,
        totalRepayableMinorUnits,
        today: "2026-02-10",
        gracePeriodDays: 0,
      }),
    ).toBe("active");
  });

  it("is overdue once a due date passes unpaid", () => {
    expect(
      computeLoanStatus({
        storedStatus: "active",
        schedule,
        verifiedRepaidMinorUnits: 0,
        totalRepayableMinorUnits,
        today: "2026-02-20",
        gracePeriodDays: 0,
      }),
    ).toBe("overdue");
  });

  it("is active, not overdue, once repayments catch up to what's cumulatively due", () => {
    expect(
      computeLoanStatus({
        storedStatus: "active",
        schedule,
        verifiedRepaidMinorUnits: 35_000,
        totalRepayableMinorUnits,
        today: "2026-02-20",
        gracePeriodDays: 0,
      }),
    ).toBe("active");
  });

  it("a grace period delays when a missed instalment counts as overdue", () => {
    const params = {
      storedStatus: "active" as const,
      schedule,
      verifiedRepaidMinorUnits: 0,
      totalRepayableMinorUnits,
      gracePeriodDays: 5,
    };
    // 4 days after the 14 Feb due date — still within a 5-day grace period.
    expect(computeLoanStatus({ ...params, today: "2026-02-18" })).toBe("active");
    // 6 days after — past the grace period.
    expect(computeLoanStatus({ ...params, today: "2026-02-20" })).toBe("overdue");
  });

  it("an early lump-sum payment prevents a later instalment from ever counting as overdue", () => {
    expect(
      computeLoanStatus({
        storedStatus: "active",
        schedule,
        verifiedRepaidMinorUnits: 105_000,
        totalRepayableMinorUnits,
        today: "2026-01-16",
        gracePeriodDays: 0,
      }),
    ).toBe("fully_repaid");
  });
});

describe("sumVerifiedRepayments", () => {
  it("counts only verified and reconciled repayments", () => {
    const records = [
      { status: "pending_verification" as const, amount_minor_units: 100 },
      { status: "verified" as const, amount_minor_units: 200 },
      { status: "rejected" as const, amount_minor_units: 300 },
      { status: "reversed" as const, amount_minor_units: 400 },
    ];
    expect(sumVerifiedRepayments(records)).toBe(200);
  });
});

describe("outstandingPrincipal", () => {
  it("subtracts only the principal portion of verified/reconciled repayments", () => {
    const repayments = [
      { status: "verified", principal_portion_minor_units: 20_000 },
      { status: "pending_verification", principal_portion_minor_units: 50_000 },
      { status: "reconciled", principal_portion_minor_units: 10_000 },
      { status: "reversed", principal_portion_minor_units: 5_000 },
    ];
    expect(outstandingPrincipal(100_000, repayments)).toBe(70_000);
  });

  it("never goes negative even if repayments somehow exceed principal", () => {
    const repayments = [{ status: "verified", principal_portion_minor_units: 200_000 }];
    expect(outstandingPrincipal(100_000, repayments)).toBe(0);
  });
});
