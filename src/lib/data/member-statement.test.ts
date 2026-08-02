import { describe, expect, it } from "vitest";
import { dayBefore } from "@/lib/data/member-statement";

describe("dayBefore", () => {
  it("subtracts one day within a month", () => {
    expect(dayBefore("2026-03-15")).toBe("2026-03-14");
  });

  it("rolls back across a month boundary", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });

  it("rolls back across a leap-year February boundary", () => {
    expect(dayBefore("2024-03-01")).toBe("2024-02-29");
  });

  it("rolls back across a year boundary", () => {
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });
});
