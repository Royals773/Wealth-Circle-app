import { createClient } from "@/lib/supabase/server";
import { computeEligibility, type LoanPolicyForEligibility, type EligibilityResult } from "@/lib/loan-eligibility";
import {
  computeLoanRepaymentSchedule,
  computeLoanStatus,
  outstandingPrincipal,
  type LoanDisplayStatus,
} from "@/lib/loans";
import { listPeriodsBetween } from "@/lib/contribution-periods";
import { computeMemberPeriodStatus, sumVerifiedAmount } from "@/lib/contributions";
import type { LoanApplicationRow } from "@/components/dashboard/loan-applications-table";
import type { LoanRow } from "@/components/dashboard/loans-table";
import type { ContributionFrequency, LoanStatus } from "@/lib/types/database";

/**
 * Shared, server-only loan calculations — the single source of truth
 * for both the Loans page's officer Overview/member "My loans" and the
 * group Overview page's Admin/Member dashboards, so a number like
 * "principal outstanding" or "eligible to borrow up to X" is always the
 * same wherever it's shown. Reuses the exact-calendar eligibility and
 * overdue math from src/lib/loan-eligibility.ts and src/lib/loans.ts —
 * nothing here re-derives an approximation of its own.
 */

export interface ActiveLoanProduct {
  id: string;
  enabled: boolean;
  maxLoanBpsOfContributions: number;
  maxAmountMinorUnits: number | null;
  interestRateBps: number;
  minTermMonths: number | null;
  maxTermMonths: number | null;
  repaymentFrequency: ContributionFrequency;
  allowOverdueMembers: boolean;
  gracePeriodDays: number;
}

export async function loadActiveLoanProduct(groupId: string): Promise<ActiveLoanProduct | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("loan_products")
    .select(
      "id, status, max_loan_bps_of_contributions, max_amount_minor_units, interest_rate_bps, min_term_months, max_term_months, repayment_frequency, allow_overdue_members, grace_period_days",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    enabled: data.status === "active",
    maxLoanBpsOfContributions: data.max_loan_bps_of_contributions,
    maxAmountMinorUnits: data.max_amount_minor_units,
    interestRateBps: data.interest_rate_bps,
    minTermMonths: data.min_term_months,
    maxTermMonths: data.max_term_months,
    repaymentFrequency: data.repayment_frequency,
    allowOverdueMembers: data.allow_overdue_members,
    gracePeriodDays: data.grace_period_days,
  };
}

export async function loadApplicationsForOfficer(groupId: string): Promise<LoanApplicationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("loan_applications")
    .select("id, applicant_id, amount_requested_minor_units, currency_code, term_months, purpose, status, created_at")
    .eq("group_id", groupId)
    .in("status", ["submitted", "under_review"])
    .order("created_at", { ascending: true });

  if (!data || data.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...new Set(data.map((a) => a.applicant_id))]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return data.map((a) => ({
    id: a.id,
    applicantName: nameById.get(a.applicant_id) ?? "Unknown member",
    amountRequestedMinorUnits: a.amount_requested_minor_units,
    currencyCode: a.currency_code,
    termMonths: a.term_months,
    purpose: a.purpose,
    status: a.status,
    createdAt: a.created_at,
  }));
}

export interface RawLoan {
  id: string;
  borrower_id: string;
  principal_minor_units: number;
  total_repayable_minor_units: number;
  currency_code: string;
  interest_amount_minor_units: number;
  term_months: number;
  repayment_frequency: ContributionFrequency;
  status: LoanStatus;
  disbursement_date: string | null;
}

export interface RawRepayment {
  loan_id: string;
  status: string;
  amount_minor_units: number;
  principal_portion_minor_units: number;
  interest_portion_minor_units: number;
}

export async function loadLoansForOfficer(
  groupId: string,
): Promise<{ loans: RawLoan[]; repayments: RawRepayment[]; names: Map<string, string> }> {
  const supabase = await createClient();
  const { data: loans } = await supabase
    .from("loans")
    .select(
      "id, borrower_id, principal_minor_units, total_repayable_minor_units, currency_code, interest_amount_minor_units, term_months, repayment_frequency, status, disbursement_date",
    )
    .eq("group_id", groupId)
    .in("status", ["awaiting_disbursement", "active", "defaulted"]);

  if (!loans || loans.length === 0) return { loans: [], repayments: [], names: new Map() };

  const { data: repayments } = await supabase
    .from("repayments")
    .select("loan_id, status, amount_minor_units, principal_portion_minor_units, interest_portion_minor_units")
    .in(
      "loan_id",
      loans.map((l) => l.id),
    );

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...new Set(loans.map((l) => l.borrower_id))]);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return { loans, repayments: repayments ?? [], names };
}

export function toDisplayStatus(
  loan: RawLoan,
  repayments: RawRepayment[],
  gracePeriodDays: number,
  today: string,
): LoanDisplayStatus {
  if (loan.status !== "active") return loan.status;

  const schedule = loan.disbursement_date
    ? computeLoanRepaymentSchedule({
        disbursementDate: loan.disbursement_date,
        termMonths: loan.term_months,
        frequency: loan.repayment_frequency,
        totalRepayableMinorUnits: loan.total_repayable_minor_units,
      })
    : [];

  return computeLoanStatus({
    storedStatus: loan.status,
    schedule,
    verifiedRepaidMinorUnits: sumVerifiedAmount(
      repayments.map((r) => ({ status: r.status as never, amount_minor_units: r.amount_minor_units })),
    ),
    totalRepayableMinorUnits: loan.total_repayable_minor_units,
    today,
    gracePeriodDays,
  });
}

export interface GroupLoanSummary {
  product: ActiveLoanProduct | null;
  currencyCode: string;
  applications: LoanApplicationRow[];
  applicationsAwaitingReviewCount: number;
  awaitingDisbursementCount: number;
  activeLoanCount: number;
  overdueCount: number;
  principalOutstanding: number;
  interestExpected: number;
  interestReceived: number;
  loanRows: LoanRow[];
}

/** The group-wide loan picture — every number an officer dashboard
 * needs, computed once from RLS-scoped rows. */
export async function loadGroupLoanSummary(
  groupId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<GroupLoanSummary> {
  const [product, applications, { loans, repayments, names }] = await Promise.all([
    loadActiveLoanProduct(groupId),
    loadApplicationsForOfficer(groupId),
    loadLoansForOfficer(groupId),
  ]);

  let currencyCode = loans[0]?.currency_code ?? applications[0]?.currencyCode ?? null;
  if (!currencyCode) {
    const supabase = await createClient();
    const { data: group } = await supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle();
    currencyCode = group?.currency_code ?? "GBP";
  }

  const gracePeriodDays = product?.gracePeriodDays ?? 0;

  const loanRows: LoanRow[] = loans.map((loan) => {
    const loanRepayments = repayments.filter((r) => r.loan_id === loan.id);
    return {
      id: loan.id,
      borrowerName: names.get(loan.borrower_id) ?? "Unknown member",
      principalMinorUnits: loan.principal_minor_units,
      totalRepayableMinorUnits: loan.total_repayable_minor_units,
      currencyCode: loan.currency_code,
      outstandingPrincipalMinorUnits: outstandingPrincipal(loan.principal_minor_units, loanRepayments),
      displayStatus: toDisplayStatus(loan, loanRepayments, gracePeriodDays, today),
    };
  });

  const principalOutstanding = loanRows
    .filter((l) => l.displayStatus === "active" || l.displayStatus === "overdue")
    .reduce((sum, l) => sum + l.outstandingPrincipalMinorUnits, 0);

  const interestExpected = loans
    .filter((l) => l.status === "active")
    .reduce((sum, l) => sum + l.interest_amount_minor_units, 0);

  const interestReceived = repayments
    .filter((r) => r.status === "verified" || r.status === "reconciled")
    .reduce((sum, r) => sum + r.interest_portion_minor_units, 0);

  return {
    product,
    currencyCode,
    applications,
    applicationsAwaitingReviewCount: applications.length,
    awaitingDisbursementCount: loanRows.filter((l) => l.displayStatus === "awaiting_disbursement").length,
    activeLoanCount: loanRows.filter((l) => l.displayStatus === "active").length,
    overdueCount: loanRows.filter((l) => l.displayStatus === "overdue").length,
    principalOutstanding,
    interestExpected,
    interestReceived,
    loanRows,
  };
}

/** The signed-in member's own eligibility — the exact same calculation
 * the apply-for-loan flow uses, so a dashboard indicator can never
 * disagree with what applying actually allows. */
export async function loadMemberLoanEligibility(
  groupId: string,
  userId: string,
  product: ActiveLoanProduct | null,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<{ eligibility: EligibilityResult; verifiedContributionsTotal: number }> {
  const supabase = await createClient();

  const [{ data: membership }, { data: myContributions }, { data: myLoans }] = await Promise.all([
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
      .select(
        "id, principal_minor_units, total_repayable_minor_units, term_months, repayment_frequency, disbursement_date, status",
      )
      .eq("group_id", groupId)
      .eq("borrower_id", userId)
      .eq("status", "active"),
  ]);

  const verifiedContributionsTotal = (myContributions ?? []).reduce((sum, r) => sum + r.amount_minor_units, 0);

  let existingOutstandingPrincipal = 0;
  let hasOverdueRepayments = false;

  if (myLoans && myLoans.length > 0) {
    const { data: myRepayments } = await supabase
      .from("repayments")
      .select("loan_id, status, amount_minor_units, principal_portion_minor_units, interest_portion_minor_units")
      .in(
        "loan_id",
        myLoans.map((l) => l.id),
      );

    for (const loan of myLoans) {
      const loanRepayments = (myRepayments ?? []).filter((r) => r.loan_id === loan.id);
      existingOutstandingPrincipal += outstandingPrincipal(loan.principal_minor_units, loanRepayments);

      if (loan.disbursement_date && product) {
        const schedule = computeLoanRepaymentSchedule({
          disbursementDate: loan.disbursement_date,
          termMonths: loan.term_months,
          frequency: loan.repayment_frequency,
          totalRepayableMinorUnits: loan.total_repayable_minor_units,
        });
        const status = computeLoanStatus({
          storedStatus: "active",
          schedule,
          verifiedRepaidMinorUnits: sumVerifiedAmount(
            loanRepayments.map((r) => ({ status: r.status as never, amount_minor_units: r.amount_minor_units })),
          ),
          totalRepayableMinorUnits: loan.total_repayable_minor_units,
          today,
          gracePeriodDays: product.gracePeriodDays,
        });
        if (status === "overdue") hasOverdueRepayments = true;
      }
    }
  }

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

  const policyForEligibility: LoanPolicyForEligibility = product
    ? {
        enabled: product.enabled,
        maxLoanBpsOfContributions: product.maxLoanBpsOfContributions,
        maxAmountMinorUnits: product.maxAmountMinorUnits,
        allowOverdueMembers: product.allowOverdueMembers,
      }
    : { enabled: false, maxLoanBpsOfContributions: 0, maxAmountMinorUnits: null, allowOverdueMembers: false };

  const eligibility = computeEligibility({
    verifiedContributionsTotal,
    existingOutstandingPrincipal,
    policy: policyForEligibility,
    membershipStatus: membership?.status ?? "removed",
    hasOverdueContributions,
    hasOverdueRepayments,
  });

  return { eligibility, verifiedContributionsTotal };
}

export interface MyLoanDetail {
  id: string;
  principalMinorUnits: number;
  totalRepayableMinorUnits: number;
  currencyCode: string;
  amountRepaidMinorUnits: number;
  outstandingMinorUnits: number;
  displayStatus: LoanDisplayStatus;
  nextDueDate: string | null;
  nextDueAmountMinorUnits: number | null;
  repayments: {
    id: string;
    amountMinorUnits: number;
    receivedAt: string;
    status: string;
  }[];
}

export async function loadMyLoansDetail(
  groupId: string,
  userId: string,
  gracePeriodDays: number,
  today: string,
): Promise<MyLoanDetail[]> {
  const supabase = await createClient();
  const { data: loans } = await supabase
    .from("loans")
    .select(
      "id, principal_minor_units, total_repayable_minor_units, currency_code, term_months, repayment_frequency, status, disbursement_date",
    )
    .eq("group_id", groupId)
    .eq("borrower_id", userId)
    .order("created_at", { ascending: false });

  if (!loans || loans.length === 0) return [];

  const { data: repayments } = await supabase
    .from("repayments")
    .select("id, loan_id, amount_minor_units, received_at, status")
    .in(
      "loan_id",
      loans.map((l) => l.id),
    )
    .order("received_at", { ascending: false });

  return loans.map((loan) => {
    const loanRepayments = (repayments ?? []).filter((r) => r.loan_id === loan.id);
    const amountRepaidMinorUnits = sumVerifiedAmount(
      loanRepayments.map((r) => ({ status: r.status as never, amount_minor_units: r.amount_minor_units })),
    );

    const schedule = loan.disbursement_date
      ? computeLoanRepaymentSchedule({
          disbursementDate: loan.disbursement_date,
          termMonths: loan.term_months,
          frequency: loan.repayment_frequency,
          totalRepayableMinorUnits: loan.total_repayable_minor_units,
        })
      : [];

    let cumulative = 0;
    let nextDueDate: string | null = null;
    let nextDueAmountMinorUnits: number | null = null;
    for (const instalment of schedule) {
      cumulative += instalment.amountMinorUnits;
      if (amountRepaidMinorUnits < cumulative) {
        nextDueDate = instalment.dueDate;
        nextDueAmountMinorUnits = cumulative - amountRepaidMinorUnits;
        break;
      }
    }

    return {
      id: loan.id,
      principalMinorUnits: loan.principal_minor_units,
      totalRepayableMinorUnits: loan.total_repayable_minor_units,
      currencyCode: loan.currency_code,
      amountRepaidMinorUnits,
      outstandingMinorUnits: Math.max(0, loan.total_repayable_minor_units - amountRepaidMinorUnits),
      displayStatus:
        loan.status !== "active"
          ? loan.status
          : computeLoanStatus({
              storedStatus: "active",
              schedule,
              verifiedRepaidMinorUnits: amountRepaidMinorUnits,
              totalRepayableMinorUnits: loan.total_repayable_minor_units,
              today,
              gracePeriodDays,
            }),
      nextDueDate,
      nextDueAmountMinorUnits,
      repayments: loanRepayments.map((r) => ({
        id: r.id,
        amountMinorUnits: r.amount_minor_units,
        receivedAt: r.received_at,
        status: r.status,
      })),
    };
  });
}
