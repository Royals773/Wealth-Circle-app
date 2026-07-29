import { describe, expect, it } from "vitest";
import { formatMoney, majorToMinorUnits, minorToMajorUnits, minorUnitsPerMajor } from "./money";

describe("minorUnitsPerMajor", () => {
  it("defaults to 100 minor units per major unit", () => {
    expect(minorUnitsPerMajor("GBP")).toBe(100);
    expect(minorUnitsPerMajor("usd")).toBe(100);
  });

  it("treats known zero-decimal currencies as 1 minor unit per major unit", () => {
    expect(minorUnitsPerMajor("JPY")).toBe(1);
    expect(minorUnitsPerMajor("ugx")).toBe(1);
  });
});

describe("majorToMinorUnits / minorToMajorUnits", () => {
  it("round-trips a two-decimal currency", () => {
    expect(majorToMinorUnits(12.5, "GBP")).toBe(1250);
    expect(minorToMajorUnits(1250, "GBP")).toBe(12.5);
  });

  it("rounds fractional minor units instead of truncating", () => {
    expect(majorToMinorUnits(10.005, "GBP")).toBe(1001);
  });

  it("does not apply decimal scaling to zero-decimal currencies", () => {
    expect(majorToMinorUnits(500, "JPY")).toBe(500);
    expect(minorToMajorUnits(500, "JPY")).toBe(500);
  });
});

describe("formatMoney", () => {
  it("formats minor units as a localized currency string", () => {
    expect(formatMoney(1250, "GBP", "en-GB")).toBe("£12.50");
  });

  it("formats zero-decimal currencies without decimal places", () => {
    expect(formatMoney(500, "JPY", "en-GB")).toBe("¥500");
  });
});
