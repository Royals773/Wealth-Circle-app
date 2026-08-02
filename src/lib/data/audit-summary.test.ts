import { describe, expect, it } from "vitest";
import { categorizeAuditAction, isFinancialDomain } from "@/lib/data/audit-summary";

describe("categorizeAuditAction", () => {
  it("categorizes every known contribution action", () => {
    for (const action of [
      "contribution_recorded",
      "contribution_verified",
      "contribution_reconciled",
      "contribution_rejected",
      "contribution_reversed",
      "contribution_edited",
    ]) {
      expect(categorizeAuditAction(action)).toBe("contribution");
    }
  });

  it("categorizes loan and repayment actions distinctly", () => {
    expect(categorizeAuditAction("loan_disbursed")).toBe("loan");
    expect(categorizeAuditAction("loan_application_approved")).toBe("loan");
    expect(categorizeAuditAction("repayment_verified")).toBe("repayment");
  });

  it("categorizes withdrawal actions", () => {
    expect(categorizeAuditAction("withdrawal_approved")).toBe("withdrawal");
    expect(categorizeAuditAction("withdrawal_paid_externally")).toBe("withdrawal");
  });

  it("categorizes governance and vote actions as governance", () => {
    expect(categorizeAuditAction("governance_proposal_created")).toBe("governance");
    expect(categorizeAuditAction("vote_cast")).toBe("governance");
  });

  it("categorizes ownership_transfer actions as membership, not a separate domain", () => {
    expect(categorizeAuditAction("ownership_transfer_initiated")).toBe("membership");
    expect(categorizeAuditAction("ownership_transfer_accepted")).toBe("membership");
  });

  it("categorizes member_* actions as membership", () => {
    expect(categorizeAuditAction("member_role_changed")).toBe("membership");
    expect(categorizeAuditAction("member_suspended")).toBe("membership");
    expect(categorizeAuditAction("member_removed")).toBe("membership");
  });

  it("categorizes invitation actions", () => {
    expect(categorizeAuditAction("invitation_accepted")).toBe("invitation");
    expect(categorizeAuditAction("invitation_revoked")).toBe("invitation");
  });

  it("falls back to other for unrecognized actions", () => {
    expect(categorizeAuditAction("something_unexpected")).toBe("other");
  });
});

describe("isFinancialDomain", () => {
  it("treats contribution, loan, repayment and withdrawal as financial", () => {
    expect(isFinancialDomain("contribution")).toBe(true);
    expect(isFinancialDomain("loan")).toBe(true);
    expect(isFinancialDomain("repayment")).toBe(true);
    expect(isFinancialDomain("withdrawal")).toBe(true);
  });

  it("does not treat governance or membership as financial", () => {
    expect(isFinancialDomain("governance")).toBe(false);
    expect(isFinancialDomain("membership")).toBe(false);
  });
});
