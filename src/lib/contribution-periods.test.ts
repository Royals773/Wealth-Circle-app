import { describe, expect, it } from "vitest";
import { getPeriodContaining, listPeriodsBetween } from "./contribution-periods";

describe("getPeriodContaining", () => {
  it("finds the weekly period containing a date", () => {
    expect(getPeriodContaining("2026-01-01", "weekly", "2026-01-05")).toEqual({
      start: "2026-01-01",
      end: "2026-01-07",
    });
    expect(getPeriodContaining("2026-01-01", "weekly", "2026-01-08")).toEqual({
      start: "2026-01-08",
      end: "2026-01-14",
    });
  });

  it("finds the biweekly period containing a date", () => {
    expect(getPeriodContaining("2026-01-01", "biweekly", "2026-01-10")).toEqual({
      start: "2026-01-01",
      end: "2026-01-14",
    });
    expect(getPeriodContaining("2026-01-01", "biweekly", "2026-01-15")).toEqual({
      start: "2026-01-15",
      end: "2026-01-28",
    });
  });

  it("finds the monthly period containing a date", () => {
    expect(getPeriodContaining("2026-01-01", "monthly", "2026-03-15")).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
  });

  it("finds the quarterly period containing a date", () => {
    expect(getPeriodContaining("2026-01-01", "quarterly", "2026-05-01")).toEqual({
      start: "2026-04-01",
      end: "2026-06-30",
    });
  });

  it("finds the annual period containing a date", () => {
    expect(getPeriodContaining("2026-01-01", "annually", "2027-06-01")).toEqual({
      start: "2027-01-01",
      end: "2027-12-31",
    });
  });

  it("clamps month-end overflow instead of producing an invalid date", () => {
    // A plan starting 31 Jan: 2026 isn't a leap year, so the 31st doesn't
    // exist in February — that period's boundary clamps to the 28th, which
    // stretches the January-anchored period all the way to 27 Feb rather
    // than overflowing into March. The period after that snaps back to the
    // 31st-anchored boundary (31 Mar) — the clamp doesn't compound/drift.
    expect(getPeriodContaining("2026-01-31", "monthly", "2026-02-15")).toEqual({
      start: "2026-01-31",
      end: "2026-02-27",
    });
    expect(getPeriodContaining("2026-01-31", "monthly", "2026-03-31")).toEqual({
      start: "2026-03-31",
      end: "2026-04-29",
    });
  });

  it("handles a leap year February correctly", () => {
    // 2028 is a leap year, so the 31st clamps to the 29th (not the 28th).
    expect(getPeriodContaining("2028-01-31", "monthly", "2028-02-20")).toEqual({
      start: "2028-01-31",
      end: "2028-02-28",
    });
  });

  it("returns the first period for a date before the plan started", () => {
    expect(getPeriodContaining("2026-03-01", "monthly", "2026-01-01")).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
    });
  });

  it("is exact at period boundaries (no off-by-one)", () => {
    const period = getPeriodContaining("2026-01-01", "monthly", "2026-01-31");
    expect(period).toEqual({ start: "2026-01-01", end: "2026-01-31" });
    const nextPeriod = getPeriodContaining("2026-01-01", "monthly", "2026-02-01");
    expect(nextPeriod).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("listPeriodsBetween", () => {
  it("lists every monthly period overlapping a range", () => {
    const periods = listPeriodsBetween("2026-01-01", "monthly", "2026-01-15", "2026-03-10");
    expect(periods).toEqual([
      { start: "2026-01-01", end: "2026-01-31" },
      { start: "2026-02-01", end: "2026-02-28" },
      { start: "2026-03-01", end: "2026-03-31" },
    ]);
  });

  it("returns a single period when the range fits inside one period", () => {
    const periods = listPeriodsBetween("2026-01-01", "quarterly", "2026-01-10", "2026-02-01");
    expect(periods).toEqual([{ start: "2026-01-01", end: "2026-03-31" }]);
  });

  it("returns an empty list when the range ends before the plan starts", () => {
    expect(listPeriodsBetween("2026-06-01", "monthly", "2026-01-01", "2026-03-01")).toEqual([]);
  });

  it("clamps the from-date to the plan start when it's earlier", () => {
    const periods = listPeriodsBetween("2026-01-01", "monthly", "2025-01-01", "2026-01-15");
    expect(periods).toEqual([{ start: "2026-01-01", end: "2026-01-31" }]);
  });
});
