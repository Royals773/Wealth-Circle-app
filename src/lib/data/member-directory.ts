import { createClient } from "@/lib/supabase/server";
import type { GroupRole, MembershipStatus } from "@/lib/types/database";

/**
 * Shared, server-only member-directory calculations. Financial-
 * obligation indicators are computed with the same set-based queries
 * `member_removal_blockers()` uses server-side inside the RPCs — this
 * module is purely for display (officers deciding whether an action is
 * even worth attempting), never the enforcement point. RLS and the RPCs
 * themselves always recheck from scratch.
 */

export interface DirectoryMember {
  userId: string;
  fullName: string;
  email: string;
  role: GroupRole;
  status: MembershipStatus;
  joinedAt: string;
  hasActiveLoan: boolean;
  hasPendingLoanApplication: boolean;
  hasUnverifiedRepayment: boolean;
  hasPendingWithdrawal: boolean;
  lastChange: MemberAuditEvent | null;
}

export interface MemberAuditEvent {
  action: string;
  actorName: string;
  reason: string | null;
  createdAt: string;
}

const MEMBER_AUDIT_ACTIONS = [
  "member_role_changed",
  "member_suspended",
  "member_reactivated",
  "member_removed",
  "member_left",
];

/** The full roster with officer-only obligation indicators and the most
 * recent role/status-change event per member. Plain members should use
 * loadBasicRoster instead — this is deliberately only ever called from
 * a manage_members-gated code path. */
export async function loadMemberDirectory(groupId: string): Promise<DirectoryMember[]> {
  const supabase = await createClient();

  const [{ data: memberships }, { data: activeLoans }, { data: pendingApplications }, { data: unverifiedRepayments }, { data: pendingWithdrawals }, { data: auditRows }] =
    await Promise.all([
      supabase
        .from("group_memberships")
        .select("user_id, role, status, joined_at")
        .eq("group_id", groupId)
        .order("joined_at", { ascending: true }),
      supabase.from("loans").select("borrower_id").eq("group_id", groupId).eq("status", "active"),
      supabase
        .from("loan_applications")
        .select("applicant_id")
        .eq("group_id", groupId)
        .in("status", ["submitted", "under_review"]),
      supabase
        .from("repayments")
        .select("member_id")
        .eq("group_id", groupId)
        .eq("status", "pending_verification"),
      supabase
        .from("withdrawal_requests")
        .select("requested_by")
        .eq("group_id", groupId)
        .in("status", ["submitted", "under_review", "approved", "awaiting_payment"]),
      supabase
        .from("audit_logs")
        .select("action, actor_id, entity_id, metadata, created_at")
        .eq("group_id", groupId)
        .in("action", MEMBER_AUDIT_ACTIONS)
        .order("created_at", { ascending: false }),
    ]);

  if (!memberships || memberships.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in(
      "id",
      memberships.map((m) => m.user_id),
    );
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const activeLoanIds = new Set((activeLoans ?? []).map((l) => l.borrower_id));
  const pendingApplicationIds = new Set((pendingApplications ?? []).map((a) => a.applicant_id));
  const unverifiedRepaymentIds = new Set((unverifiedRepayments ?? []).map((r) => r.member_id));
  const pendingWithdrawalIds = new Set((pendingWithdrawals ?? []).map((w) => w.requested_by));

  const lastChangeByMember = new Map<string, MemberAuditEvent>();
  for (const row of auditRows ?? []) {
    if (!row.entity_id || lastChangeByMember.has(row.entity_id)) continue;
    lastChangeByMember.set(row.entity_id, {
      action: row.action,
      actorName: profileById.get(row.actor_id ?? "")?.full_name ?? "Unknown",
      reason: typeof row.metadata === "object" && row.metadata && "reason" in row.metadata
        ? String((row.metadata as Record<string, unknown>).reason ?? "") || null
        : null,
      createdAt: row.created_at,
    });
  }

  return memberships.map((m) => ({
    userId: m.user_id,
    fullName: profileById.get(m.user_id)?.full_name ?? "Unknown member",
    email: profileById.get(m.user_id)?.email ?? "",
    role: m.role,
    status: m.status,
    joinedAt: m.joined_at,
    hasActiveLoan: activeLoanIds.has(m.user_id),
    hasPendingLoanApplication: pendingApplicationIds.has(m.user_id),
    hasUnverifiedRepayment: unverifiedRepaymentIds.has(m.user_id),
    hasPendingWithdrawal: pendingWithdrawalIds.has(m.user_id),
    lastChange: lastChangeByMember.get(m.user_id) ?? null,
  }));
}

export interface BasicRosterMember {
  userId: string;
  fullName: string;
  role: GroupRole;
  status: MembershipStatus;
  joinedAt: string;
}

/** The existing, unrestricted roster view every active member has
 * always seen — name, role, status, join date. Unchanged privacy model
 * from Phase 1/2. */
export async function loadBasicRoster(groupId: string): Promise<BasicRosterMember[]> {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("user_id, role, status, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  if (!memberships || memberships.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in(
      "id",
      memberships.map((m) => m.user_id),
    );
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return memberships.map((m) => ({
    userId: m.user_id,
    fullName: nameById.get(m.user_id) ?? "Unknown member",
    role: m.role,
    status: m.status,
    joinedAt: m.joined_at,
  }));
}

export interface PendingOwnershipTransfer {
  id: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
}

export async function loadPendingOwnershipTransfer(groupId: string): Promise<PendingOwnershipTransfer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ownership_transfers")
    .select("id, from_user_id, to_user_id, reason, created_at, expires_at")
    .eq("group_id", groupId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [data.from_user_id, data.to_user_id]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return {
    id: data.id,
    fromUserId: data.from_user_id,
    fromUserName: nameById.get(data.from_user_id) ?? "Unknown member",
    toUserId: data.to_user_id,
    toUserName: nameById.get(data.to_user_id) ?? "Unknown member",
    reason: data.reason,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
  };
}
