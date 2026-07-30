import { describe, expect, it } from "vitest";
import { computeMemberPeriodStatus, requiredAmountForPeriod, sumVerifiedAmount } from "./contributions";

const period = { start: "2026-02-01", end: "2026-02-28" };
const fixedPlan = { isFlexible: false, amountMinorUnits: 5000, minimumAmountMinorUnits: null };
const flexibleNoMinimum = { isFlexible: true, amountMinorUnits: null, minimumAmountMinorUnits: null };
const flexibleWithMinimum = { isFlexible: true, amountMinorUnits: null, minimumAmountMinorUnits: 2000 };

describe("sumVerifiedAmount", () => {
  it("counts only verified and reconciled rows", () => {
    const records = [
      { status: "pending_verification" as const, amount_minor_units: 100 },
      { status: "verified" as const, amount_minor_units: 200 },
      { status: "reconciled" as const, amount_minor_units: 300 },
      { status: "rejected" as const, amount_minor_units: 400 },
      { status: "reversed" as const, amount_minor_units: 500 },
    ];
    expect(sumVerifiedAmount(records)).toBe(500);
  });

  it("returns zero for an empty list", () => {
    expect(sumVerifiedAmount([])).toBe(0);
  });

  it("excludes a reversed contribution even though it was once verified", () => {
    // Simulates: a record was verified (200), then later reversed — the
    // reversal flips its own status to 'reversed', so it must drop out of
    // the total even though money was, at one point, marked verified.
    const records = [{ status: "reversed" as const, amount_minor_units: 200 }];
    expect(sumVerifiedAmount(records)).toBe(0);
  });
});

describe("requiredAmountForPeriod", () => {
  it("returns the fixed amount for a fixed plan", () => {
    expect(requiredAmountForPeriod(fixedPlan)).toBe(5000);
  });

  it("returns null for a flexible plan with no minimum", () => {
    expect(requiredAmountForPeriod(flexibleNoMinimum)).toBeNull();
  });

  it("returns the minimum for a flexible plan that defines one", () => {
    expect(requiredAmountForPeriod(flexibleWithMinimum)).toBe(2000);
  });
});

describe("computeMemberPeriodStatus", () => {
  it("is never overdue for a flexible plan with no minimum, regardless of amount paid", () => {
    expect(
      computeMemberPeriodStatus({
        plan: flexibleNoMinimum,
        period,
        verifiedTotal: 0,
        today: "2026-05-01",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("not_applicable");
  });

  it("treats a flexible plan with a minimum like a fixed target", () => {
    expect(
      computeMemberPeriodStatus({
        plan: flexibleWithMinimum,
        period,
        verifiedTotal: 1000,
        today: "2026-05-01",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("overdue");
    expect(
      computeMemberPeriodStatus({
        plan: flexibleWithMinimum,
        period,
        verifiedTotal: 2000,
        today: "2026-05-01",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("paid");
  });

  it("is not_applicable for a period that ended before the member joined", () => {
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 0,
        today: "2026-05-01",
        memberJoinedAt: "2026-03-15",
      }),
    ).toBe("not_applicable");
  });

  it("is paid once the verified total meets the required amount", () => {
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 5000,
        today: "2026-02-15",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("paid");
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 6000,
        today: "2026-02-15",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("paid");
  });

  it("is unpaid before the due date with nothing paid", () => {
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 0,
        today: "2026-02-10",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("unpaid");
  });

  it("is partial before the due date with something paid", () => {
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 2500,
        today: "2026-02-10",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("partial");
  });

  it("is overdue after the due date whether zero or partially paid", () => {
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 0,
        today: "2026-03-01",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("overdue");
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 2500,
        today: "2026-03-01",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("overdue");
  });

  it("is paid, not overdue, when fully paid even after the due date", () => {
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 5000,
        today: "2026-03-01",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("paid");
  });

  it("is exactly at the due date boundary (period.end) treated as not yet overdue", () => {
    expect(
      computeMemberPeriodStatus({
        plan: fixedPlan,
        period,
        verifiedTotal: 0,
        today: "2026-02-28",
        memberJoinedAt: "2026-01-01",
      }),
    ).toBe("unpaid");
  });
});
