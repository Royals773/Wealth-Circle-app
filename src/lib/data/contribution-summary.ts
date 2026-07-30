import { createClient } from "@/lib/supabase/server";
import { getPeriodContaining, listPeriodsBetween } from "@/lib/contribution-periods";
import {
  computeMemberPeriodStatus,
  requiredAmountForPeriod,
  sumVerifiedAmount,
  type MemberPeriodStatus,
} from "@/lib/contributions";
import type { ContributionFrequency, ContributionRecordStatus, PaymentMethod } from "@/lib/types/database";

/**
 * Shared, server-only contribution calculations — the single source of
 * truth for both the Contributions page's treasurer Overview and the
 * group Overview page's Admin/Member dashboards, so the same number
 * (e.g. "expected this period") can never disagree between the two
 * places it's shown. Every function here does real Supabase reads
 * against RLS-scoped rows; nothing is a placeholder.
 */

export interface ActivePlan {
  id: string;
  isFlexible: boolean;
  amountMinorUnits: number | null;
  minimumAmountMinorUnits: number | null;
  frequency: ContributionFrequency;
  startDate: string;
  currencyCode: string;
}

export interface ActiveMember {
  userId: string;
  fullName: string;
  joinedAt: string;
}

export interface RawContributionRecord {
  id: string;
  member_id: string;
  amount_minor_units: number;
  currency_code: string;
  period_start: string | null;
  period_end: string | null;
  received_at: string;
  payment_method: PaymentMethod | null;
  payment_reference: string | null;
  status: ContributionRecordStatus;
  reversal_of: string | null;
}

export const CONTRIBUTION_RECORD_COLUMNS =
  "id, member_id, amount_minor_units, currency_code, period_start, period_end, received_at, payment_method, payment_reference, status, reversal_of";

export async function loadPlan(groupId: string): Promise<ActivePlan | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contribution_plans")
    .select(
      "id, is_flexible, amount_minor_units, minimum_amount_minor_units, frequency, start_date, currency_code",
    )
    .eq("group_id", groupId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    isFlexible: data.is_flexible,
    amountMinorUnits: data.amount_minor_units,
    minimumAmountMinorUnits: data.minimum_amount_minor_units,
    frequency: data.frequency,
    startDate: data.start_date,
    currencyCode: data.currency_code,
  };
}

export async function loadActiveMembers(groupId: string): Promise<ActiveMember[]> {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("user_id, joined_at")
    .eq("group_id", groupId)
    .eq("status", "active");

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
    joinedAt: m.joined_at.slice(0, 10),
  }));
}

export async function loadAllRecords(groupId: string): Promise<RawContributionRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contribution_records")
    .select(CONTRIBUTION_RECORD_COLUMNS)
    .eq("group_id", groupId);
  return data ?? [];
}

export async function loadMyRecords(groupId: string, userId: string): Promise<RawContributionRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contribution_records")
    .select(CONTRIBUTION_RECORD_COLUMNS)
    .eq("group_id", groupId)
    .eq("member_id", userId)
    .order("received_at", { ascending: false });
  return data ?? [];
}

export interface MemberPeriodStatusRow {
  memberId: string;
  memberName: string;
  verifiedTotal: number;
  requiredAmount: number | null;
  status: MemberPeriodStatus;
}

export interface GroupContributionSummary {
  plan: ActivePlan | null;
  expectedTotal: number;
  receivedTotal: number;
  verifiedTotal: number;
  pendingTotal: number;
  outstandingTotal: number;
  overdueMemberCount: number;
  fullyPaidCount: number;
  partlyPaidCount: number;
  unpaidCount: number;
  /** One row per active member, for the current period — what the
   * treasurer's "monthly contribution status" table is built from. */
  memberStatuses: MemberPeriodStatusRow[];
}

const EMPTY_SUMMARY: Omit<GroupContributionSummary, "plan"> = {
  expectedTotal: 0,
  receivedTotal: 0,
  verifiedTotal: 0,
  pendingTotal: 0,
  outstandingTotal: 0,
  overdueMemberCount: 0,
  fullyPaidCount: 0,
  partlyPaidCount: 0,
  unpaidCount: 0,
  memberStatuses: [],
};

/** The group-wide contribution picture: aggregate totals plus a
 * per-member breakdown for the current period. Computed fresh from
 * RLS-scoped rows on every call — never cached or trusted from the
 * client. */
export async function loadGroupContributionSummary(
  groupId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<GroupContributionSummary> {
  const plan = await loadPlan(groupId);
  if (!plan) return { plan: null, ...EMPTY_SUMMARY };

  const [members, allRecords] = await Promise.all([loadActiveMembers(groupId), loadAllRecords(groupId)]);

  const currentPeriod = getPeriodContaining(plan.startDate, plan.frequency, today);
  const target = {
    isFlexible: plan.isFlexible,
    amountMinorUnits: plan.amountMinorUnits,
    minimumAmountMinorUnits: plan.minimumAmountMinorUnits,
  };

  let expectedTotal = 0;
  let currentPeriodVerifiedTotal = 0;
  let fullyPaidCount = 0;
  let partlyPaidCount = 0;
  let unpaidCount = 0;
  const overdueMemberIds = new Set<string>();
  const memberStatuses: MemberPeriodStatusRow[] = [];

  for (const member of members) {
    const effectiveFrom = member.joinedAt > plan.startDate ? member.joinedAt : plan.startDate;
    const periods = listPeriodsBetween(plan.startDate, plan.frequency, effectiveFrom, today);

    for (const period of periods) {
      const periodRecords = allRecords.filter(
        (r) => r.member_id === member.userId && r.period_start === period.start,
      );
      const verifiedTotal = sumVerifiedAmount(periodRecords);
      const status: MemberPeriodStatus = computeMemberPeriodStatus({
        plan: target,
        period,
        verifiedTotal,
        today,
        memberJoinedAt: member.joinedAt,
      });

      if (status === "overdue") overdueMemberIds.add(member.userId);

      if (period.start === currentPeriod.start) {
        currentPeriodVerifiedTotal += verifiedTotal;
        const required = requiredAmountForPeriod(target);
        if (required !== null) expectedTotal += required;
        if (status === "paid") fullyPaidCount += 1;
        else if (status === "partial") partlyPaidCount += 1;
        else if (status === "unpaid" || status === "overdue") unpaidCount += 1;

        memberStatuses.push({
          memberId: member.userId,
          memberName: member.fullName,
          verifiedTotal,
          requiredAmount: required,
          status,
        });
      }
    }
  }

  const receivedTotal = allRecords
    .filter((r) => r.status !== "rejected" && r.status !== "reversed")
    .reduce((sum, r) => sum + r.amount_minor_units, 0);
  const verifiedTotal = sumVerifiedAmount(allRecords);
  const pendingTotal = allRecords
    .filter((r) => r.status === "pending_verification")
    .reduce((sum, r) => sum + r.amount_minor_units, 0);

  return {
    plan,
    expectedTotal,
    receivedTotal,
    verifiedTotal,
    pendingTotal,
    outstandingTotal: Math.max(0, expectedTotal - currentPeriodVerifiedTotal),
    overdueMemberCount: overdueMemberIds.size,
    fullyPaidCount,
    partlyPaidCount,
    unpaidCount,
    memberStatuses,
  };
}

export interface MissedContribution {
  periodStart: string;
  periodEnd: string;
  requiredAmount: number;
  verifiedAmount: number;
  shortfallAmount: number;
}

/** Every period, since the member joined, where their status is
 * 'overdue' — the data behind the member dashboard's "missed
 * contributions" list. */
export async function loadMemberMissedContributions(
  groupId: string,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<MissedContribution[]> {
  const plan = await loadPlan(groupId);
  if (!plan) return [];

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("group_memberships")
    .select("joined_at")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return [];

  const joinedAt = membership.joined_at.slice(0, 10);
  const target = {
    isFlexible: plan.isFlexible,
    amountMinorUnits: plan.amountMinorUnits,
    minimumAmountMinorUnits: plan.minimumAmountMinorUnits,
  };
  const required = requiredAmountForPeriod(target);
  if (required === null) return [];

  const myRecords = await loadMyRecords(groupId, userId);
  const effectiveFrom = joinedAt > plan.startDate ? joinedAt : plan.startDate;
  const periods = listPeriodsBetween(plan.startDate, plan.frequency, effectiveFrom, today);

  const missed: MissedContribution[] = [];
  for (const period of periods) {
    const periodRecords = myRecords.filter((r) => r.period_start === period.start);
    const verifiedTotal = sumVerifiedAmount(periodRecords);
    const status = computeMemberPeriodStatus({
      plan: target,
      period,
      verifiedTotal,
      today,
      memberJoinedAt: joinedAt,
    });

    if (status === "overdue") {
      missed.push({
        periodStart: period.start,
        periodEnd: period.end,
        requiredAmount: required,
        verifiedAmount: verifiedTotal,
        shortfallAmount: required - verifiedTotal,
      });
    }
  }

  return missed;
}
