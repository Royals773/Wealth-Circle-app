import { createClient } from "@/lib/supabase/server";
import { listPeriodsBetween } from "@/lib/contribution-periods";
import { computeMemberPeriodStatus } from "@/lib/contributions";
import { outstandingPrincipal } from "@/lib/loans";
import {
  computeWithdrawalEligibility,
  type WithdrawalEligibilityResult,
  type WithdrawalPolicyForEligibility,
} from "@/lib/withdrawals";
import type { GroupRole, WithdrawalStatus } from "@/lib/types/database";

/**
 * Shared, server-only withdrawal calculations — the single source of
 * truth for both the Withdrawals page and the group Overview dashboard,
 * so "available to withdraw" and the officer queue counts can never
 * disagree between the two places they're shown. Every function here
 * does real Supabase reads against RLS-scoped rows.
 */

export interface ActiveWithdrawalPolicy {
  id: string;
  enabled: boolean;
  minAmountMinorUnits: number | null;
  maxAmountMinorUnits: number | null;
  noticePeriodDays: number;
  allowPartial: boolean;
  reviewerRoles: GroupRole[];
  requiredApprovals: number;
  allowOverdueMembers: boolean;
  blockMembersWithActiveLoans: boolean;
  largeWithdrawalThresholdMinorUnits: number | null;
}

export async function loadWithdrawalPolicy(groupId: string): Promise<ActiveWithdrawalPolicy | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("withdrawal_policies")
    .select(
      "id, status, min_amount_minor_units, max_amount_minor_units, notice_period_days, allow_partial, reviewer_roles, required_approvals, allow_overdue_members, block_members_with_active_loans, large_withdrawal_threshold_minor_units",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    enabled: data.status === "active",
    minAmountMinorUnits: data.min_amount_minor_units,
    maxAmountMinorUnits: data.max_amount_minor_units,
    noticePeriodDays: data.notice_period_days,
    allowPartial: data.allow_partial,
    reviewerRoles: data.reviewer_roles,
    requiredApprovals: data.required_approvals,
    allowOverdueMembers: data.allow_overdue_members,
    blockMembersWithActiveLoans: data.block_members_with_active_loans,
    largeWithdrawalThresholdMinorUnits: data.large_withdrawal_threshold_minor_units,
  };
}

export interface RawWithdrawalRequest {
  id: string;
  requested_by: string;
  amount_minor_units: number;
  currency_code: string;
  reason: string;
  status: WithdrawalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_notes: string | null;
  paid_amount_minor_units: number | null;
  payment_date: string | null;
  paid_bank_reference: string | null;
  paid_by: string | null;
  payment_note: string | null;
  linked_proposal_id: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export const WITHDRAWAL_REQUEST_COLUMNS =
  "id, requested_by, amount_minor_units, currency_code, reason, status, reviewed_by, reviewed_at, decision_notes, paid_amount_minor_units, payment_date, paid_bank_reference, paid_by, payment_note, linked_proposal_id, reversal_reason, created_at";

export async function loadAllWithdrawalRequests(groupId: string): Promise<RawWithdrawalRequest[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("withdrawal_requests")
    .select(WITHDRAWAL_REQUEST_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function loadMyWithdrawalRequests(groupId: string, userId: string): Promise<RawWithdrawalRequest[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("withdrawal_requests")
    .select(WITHDRAWAL_REQUEST_COLUMNS)
    .eq("group_id", groupId)
    .eq("requested_by", userId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

const RESERVING_STATUSES: WithdrawalStatus[] = ["submitted", "under_review", "approved", "awaiting_payment"];

/** Statuses that permanently or temporarily reduce a member's available
 * balance: still-open requests reserve the funds, and a paid_externally
 * request has actually taken them — both must be subtracted so the
 * balance can never be double-spent. Only rejected/cancelled/reversed
 * requests give the amount back. */
const UNAVAILABLE_STATUSES: WithdrawalStatus[] = [...RESERVING_STATUSES, "paid_externally"];

/** The signed-in member's own withdrawal picture: the exact same
 * eligibility calculation request_withdrawal() itself uses, so a
 * dashboard indicator can never disagree with what requesting actually
 * allows. */
export async function loadMemberWithdrawalAvailability(
  groupId: string,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<{
  policy: ActiveWithdrawalPolicy | null;
  eligibility: WithdrawalEligibilityResult;
  verifiedContributionsTotal: number;
}> {
  const supabase = await createClient();

  const policy = await loadWithdrawalPolicy(groupId);

  const [{ data: membership }, { data: myContributions }, { data: myLoans }, { data: myRequests }] =
    await Promise.all([
      supabase
        .from("group_memberships")
        .select("status, joined_at")
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("contribution_records")
        .select("amount_minor_units, status, period_start")
        .eq("group_id", groupId)
        .eq("member_id", userId)
        .in("status", ["verified", "reconciled"]),
      supabase
        .from("loans")
        .select("id, principal_minor_units")
        .eq("group_id", groupId)
        .eq("borrower_id", userId)
        .eq("status", "active"),
      supabase
        .from("withdrawal_requests")
        .select("amount_minor_units, paid_amount_minor_units, status")
        .eq("group_id", groupId)
        .eq("requested_by", userId)
        .in("status", UNAVAILABLE_STATUSES),
    ]);

  const verifiedContributionsTotal = (myContributions ?? []).reduce((sum, r) => sum + r.amount_minor_units, 0);
  const hasActiveLoan = (myLoans ?? []).length > 0;

  let outstandingLoanPrincipal = 0;
  if (myLoans && myLoans.length > 0) {
    const { data: myRepayments } = await supabase
      .from("repayments")
      .select("loan_id, status, principal_portion_minor_units")
      .in(
        "loan_id",
        myLoans.map((l) => l.id),
      );
    for (const loan of myLoans) {
      outstandingLoanPrincipal += outstandingPrincipal(
        loan.principal_minor_units,
        (myRepayments ?? []).filter((r) => r.loan_id === loan.id),
      );
    }
  }

  const reservedAmount = (myRequests ?? []).reduce(
    (sum, r) => sum + (r.status === "paid_externally" ? (r.paid_amount_minor_units ?? r.amount_minor_units) : r.amount_minor_units),
    0,
  );

  let hasOverdueContributions = false;
  const { data: myPlan } = await supabase
    .from("contribution_plans")
    .select("is_flexible, amount_minor_units, minimum_amount_minor_units, frequency, start_date")
    .eq("group_id", groupId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (myPlan && membership) {
    const periods = listPeriodsBetween(myPlan.start_date, myPlan.frequency, myPlan.start_date, today);
    for (const period of periods) {
      const periodVerifiedTotal = (myContributions ?? [])
        .filter((r) => r.period_start === period.start)
        .reduce((sum, r) => sum + r.amount_minor_units, 0);
      const status = computeMemberPeriodStatus({
        plan: {
          isFlexible: myPlan.is_flexible,
          amountMinorUnits: myPlan.amount_minor_units,
          minimumAmountMinorUnits: myPlan.minimum_amount_minor_units,
        },
        period,
        verifiedTotal: periodVerifiedTotal,
        today,
        memberJoinedAt: membership.joined_at.slice(0, 10),
      });
      if (status === "overdue") {
        hasOverdueContributions = true;
        break;
      }
    }
  }

  const policyForEligibility: WithdrawalPolicyForEligibility = policy
    ? {
        enabled: policy.enabled,
        minAmountMinorUnits: policy.minAmountMinorUnits,
        maxAmountMinorUnits: policy.maxAmountMinorUnits,
        allowPartial: policy.allowPartial,
        allowOverdueMembers: policy.allowOverdueMembers,
        blockMembersWithActiveLoans: policy.blockMembersWithActiveLoans,
        largeWithdrawalThresholdMinorUnits: policy.largeWithdrawalThresholdMinorUnits,
      }
    : {
        enabled: false,
        minAmountMinorUnits: null,
        maxAmountMinorUnits: null,
        allowPartial: true,
        allowOverdueMembers: false,
        blockMembersWithActiveLoans: false,
        largeWithdrawalThresholdMinorUnits: null,
      };

  const eligibility = computeWithdrawalEligibility({
    verifiedContributionsTotal,
    outstandingLoanPrincipal,
    reservedAmount,
    hasActiveLoan,
    hasOverdueContributions,
    policy: policyForEligibility,
    membershipStatus: membership?.status ?? "removed",
  });

  return { policy, eligibility, verifiedContributionsTotal };
}

export interface GroupWithdrawalSummary {
  policy: ActiveWithdrawalPolicy | null;
  currencyCode: string;
  requests: RawWithdrawalRequest[];
  awaitingReviewCount: number;
  underReviewCount: number;
  awaitingPaymentCount: number;
  totalPendingMinorUnits: number;
  totalPaidMinorUnits: number;
}

/** The group-wide withdrawal picture — every number an officer
 * dashboard needs, computed once from RLS-scoped rows. */
export async function loadGroupWithdrawalSummary(groupId: string): Promise<GroupWithdrawalSummary> {
  const supabase = await createClient();
  const [policy, requests, group] = await Promise.all([
    loadWithdrawalPolicy(groupId),
    loadAllWithdrawalRequests(groupId),
    supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle(),
  ]);

  const currencyCode = requests[0]?.currency_code ?? group.data?.currency_code ?? "GBP";

  const awaitingReviewCount = requests.filter((r) => r.status === "submitted").length;
  const underReviewCount = requests.filter((r) => r.status === "under_review").length;
  const awaitingPaymentCount = requests.filter((r) => r.status === "awaiting_payment").length;

  const totalPendingMinorUnits = requests
    .filter((r) => RESERVING_STATUSES.includes(r.status))
    .reduce((sum, r) => sum + r.amount_minor_units, 0);

  const totalPaidMinorUnits = requests
    .filter((r) => r.status === "paid_externally")
    .reduce((sum, r) => sum + (r.paid_amount_minor_units ?? 0), 0);

  return {
    policy,
    currencyCode,
    requests,
    awaitingReviewCount,
    underReviewCount,
    awaitingPaymentCount,
    totalPendingMinorUnits,
    totalPaidMinorUnits,
  };
}
