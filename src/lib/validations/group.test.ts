import { describe, expect, it } from "vitest";
import {
  groupContributionSettingsSchema,
  groupDetailsSchema,
  joinGroupSchema,
} from "./group";

describe("groupDetailsSchema", () => {
  const valid = {
    name: "Riverside Savings Circle",
    slug: "riverside-savings-circle",
    countryCode: "GB",
    currencyCode: "GBP",
  };

  it("accepts well-formed group details", () => {
    expect(groupDetailsSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a slug with uppercase letters or spaces", () => {
    expect(groupDetailsSchema.safeParse({ ...valid, slug: "Riverside Circle" }).success).toBe(
      false,
    );
  });

  it("rejects a country or currency code of the wrong length", () => {
    expect(groupDetailsSchema.safeParse({ ...valid, countryCode: "GBR" }).success).toBe(false);
    expect(groupDetailsSchema.safeParse({ ...valid, currencyCode: "GB" }).success).toBe(false);
  });
});

describe("groupContributionSettingsSchema", () => {
  it("requires a fixed amount when the contribution type is fixed", () => {
    const result = groupContributionSettingsSchema.safeParse({
      contributionFrequency: "monthly",
      contributionType: "fixed",
      financialYearStartMonth: 1,
    });
    expect(result.success).toBe(false);
  });

  it("does not require an amount for flexible contributions", () => {
    const result = groupContributionSettingsSchema.safeParse({
      contributionFrequency: "monthly",
      contributionType: "flexible",
      financialYearStartMonth: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a financial year start month outside 1-12", () => {
    const result = groupContributionSettingsSchema.safeParse({
      contributionFrequency: "monthly",
      contributionType: "flexible",
      financialYearStartMonth: 13,
    });
    expect(result.success).toBe(false);
  });
});

describe("joinGroupSchema", () => {
  it("requires a 64-character hex invitation token", () => {
    expect(
      joinGroupSchema.safeParse({
        invitationToken: "a".repeat(64),
      }).success,
    ).toBe(true);
    expect(joinGroupSchema.safeParse({ invitationToken: "not-a-token" }).success).toBe(false);
    expect(
      joinGroupSchema.safeParse({
        invitationToken: "123e4567-e89b-12d3-a456-426614174000",
      }).success,
    ).toBe(false);
  });
});
