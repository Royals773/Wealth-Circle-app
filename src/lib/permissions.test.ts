import { describe, expect, it } from "vitest";
import {
  GROUP_ROLES,
  canApproveOwnRequest,
  capabilitiesForRole,
  roleHasCapability,
} from "./permissions";

describe("roleHasCapability", () => {
  it("gives owners and administrators every capability", () => {
    const ownerCapabilities = capabilitiesForRole("owner");
    const adminCapabilities = capabilitiesForRole("administrator");
    expect(ownerCapabilities).toEqual(adminCapabilities);
    expect(roleHasCapability("owner", "manage_group_settings")).toBe(true);
    expect(roleHasCapability("administrator", "manage_group_settings")).toBe(true);
  });

  it("restricts ordinary members to voting and proposing", () => {
    expect(roleHasCapability("member", "vote_on_proposal")).toBe(true);
    expect(roleHasCapability("member", "create_governance_proposal")).toBe(true);
    expect(roleHasCapability("member", "manage_members")).toBe(false);
    expect(roleHasCapability("member", "approve_withdrawal")).toBe(false);
  });

  it("scopes the treasurer to financial recording and approval, not loans", () => {
    expect(roleHasCapability("treasurer", "record_contributions")).toBe(true);
    expect(roleHasCapability("treasurer", "approve_withdrawal")).toBe(true);
    expect(roleHasCapability("treasurer", "review_loan_applications")).toBe(false);
  });

  it("scopes the loan officer to loans, not contributions or withdrawals", () => {
    expect(roleHasCapability("loan_officer", "review_loan_applications")).toBe(true);
    expect(roleHasCapability("loan_officer", "record_contributions")).toBe(false);
    expect(roleHasCapability("loan_officer", "approve_withdrawal")).toBe(false);
  });

  it("gives the auditor read access only", () => {
    expect(roleHasCapability("auditor", "view_audit_log")).toBe(true);
    expect(roleHasCapability("auditor", "view_reports")).toBe(true);
    expect(roleHasCapability("auditor", "record_contributions")).toBe(false);
    expect(roleHasCapability("auditor", "manage_members")).toBe(false);
  });

  it("defines every declared role", () => {
    for (const role of GROUP_ROLES) {
      expect(capabilitiesForRole(role).length).toBeGreaterThan(0);
    }
  });
});

describe("canApproveOwnRequest", () => {
  it("is always false, enforcing that self-approval is never allowed", () => {
    expect(canApproveOwnRequest()).toBe(false);
  });
});
