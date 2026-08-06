import type { GroupRole } from "@/lib/types/database";

/**
 * Capability model for group-specific roles. This mirrors the intent of
 * the Row Level Security policies in supabase/migrations/0001_init.sql —
 * it exists so the UI can show/hide actions correctly, but it is never the
 * actual security boundary. RLS on the database is the enforcement point;
 * this module only prevents the UI from offering actions a user's role
 * could never complete.
 */
export const GROUP_ROLES = [
  "owner",
  "administrator",
  "treasurer",
  "loan_officer",
  "auditor",
  "member",
] as const;

export const ROLE_LABELS: Record<GroupRole, string> = {
  owner: "Group owner",
  administrator: "Administrator",
  treasurer: "Treasurer",
  loan_officer: "Loan officer",
  auditor: "Auditor",
  member: "Ordinary member",
};

export const ROLE_DESCRIPTIONS: Record<GroupRole, string> = {
  owner:
    "Full authority over the group, including membership, rules, and closing the group.",
  administrator: "Manages members, settings, and day-to-day operations alongside the owner.",
  treasurer: "Records and verifies contributions, withdrawals, and reconciliations.",
  loan_officer: "Reviews loan applications and manages disbursed loans and repayments.",
  auditor: "Read access to records and audit logs to independently verify the group's books.",
  member: "Submits their own contributions and loan applications and votes on proposals.",
};

export const CAPABILITIES = [
  "manage_group_settings",
  "manage_members",
  "manage_contribution_plans",
  "record_contributions",
  "verify_contributions",
  "request_withdrawal",
  "manage_withdrawal_policy",
  "approve_withdrawal",
  "manage_loan_products",
  "review_loan_applications",
  "record_repayments",
  "manage_constitution",
  "import_historical_contributions",
  "create_governance_proposal",
  "vote_on_proposal",
  "view_audit_log",
  "view_reports",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// Owner and administrator carry the same full management authority as
// public.is_group_manager() in the RLS policies — both can do everything
// below; the distinction between the two roles is organisational, not a
// difference in capability.
const ROLE_CAPABILITIES: Record<GroupRole, ReadonlySet<Capability>> = {
  owner: new Set(CAPABILITIES),
  administrator: new Set(CAPABILITIES),
  treasurer: new Set<Capability>([
    "record_contributions",
    "verify_contributions",
    "manage_contribution_plans",
    "request_withdrawal",
    "approve_withdrawal",
    "record_repayments",
    "vote_on_proposal",
    "create_governance_proposal",
    "view_reports",
  ]),
  loan_officer: new Set<Capability>([
    "manage_loan_products",
    "review_loan_applications",
    "record_repayments",
    "request_withdrawal",
    "vote_on_proposal",
    "create_governance_proposal",
    "view_reports",
  ]),
  auditor: new Set<Capability>([
    "view_audit_log",
    "view_reports",
    "request_withdrawal",
    "vote_on_proposal",
    "create_governance_proposal",
  ]),
  member: new Set<Capability>(["request_withdrawal", "vote_on_proposal", "create_governance_proposal"]),
};

export function roleHasCapability(role: GroupRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function capabilitiesForRole(role: GroupRole): Capability[] {
  return CAPABILITIES.filter((capability) => roleHasCapability(role, capability));
}

/**
 * Two-person approval is required for sensitive financial actions
 * regardless of role. A single treasurer, however senior, cannot both
 * request and approve the same withdrawal.
 */
export function canApproveOwnRequest(): boolean {
  return false;
}
