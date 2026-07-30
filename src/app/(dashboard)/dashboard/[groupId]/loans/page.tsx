import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApplyForLoanDialog } from "@/components/dashboard/apply-for-loan-dialog";
import {
  LoanApplicationsTable,
  type LoanApplicationRow,
} from "@/components/dashboard/loan-applications-table";
import { LoansTable, type LoanRow } from "@/components/dashboard/loans-table";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { computeEligibility, type LoanPolicyForEligibility } from "@/lib/loan-eligibility";
import {
  computeLoanRepaymentSchedule,
  computeLoanStatus,
  outstandingPrincipal,
  type LoanDisplayStatus,
} from "@/lib/loans";
import { listPeriodsBetween } from "@/lib/contribution-periods";
import { computeMemberPeriodStatus, sumVerifiedAmount } from "@/lib/contributions";
import { formatMoney } from "@/lib/money";
import type { ContributionFrequency, LoanApplicationStatus, LoanStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Loans" };

interface ActiveLoanProduct {
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

async function loadActiveLoanProduct(groupId: string): Promise<ActiveLoanProduct | null> {
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

async function loadApplicationsForOfficer(groupId: string): Promise<LoanApplicationRow[]> {
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

interface RawLoan {
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

interface RawRepayment {
  loan_id: string;
  status: string;
  amount_minor_units: number;
  principal_portion_minor_units: number;
  interest_portion_minor_units: number;
}

async function loadLoansForOfficer(groupId: string): Promise<{ loans: RawLoan[]; repayments: RawRepayment[]; names: Map<string, string> }> {
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

function toDisplayStatus(loan: RawLoan, repayments: RawRepayment[], gracePeriodDays: number, today: string): LoanDisplayStatus {
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

async function loadEligibility(
  groupId: string,
  userId: string,
  product: ActiveLoanProduct | null,
  today: string,
): Promise<{
  eligibility: ReturnType<typeof computeEligibility>;
  verifiedContributionsTotal: number;
}> {
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

async function loadMyLoansDetail(groupId: string, userId: string, gracePeriodDays: number, today: string): Promise<MyLoanDetail[]> {
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

const APPLICATION_STATUS_LABELS: Record<LoanApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const MY_LOAN_STATUS_LABELS: Record<LoanDisplayStatus, string> = {
  awaiting_disbursement: "Awaiting disbursement",
  active: "Active",
  overdue: "Overdue",
  fully_repaid: "Fully repaid",
  defaulted: "Defaulted",
  cancelled: "Cancelled",
};

export default async function LoansPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Loans"
          description="Review loan applications and track active loans from disbursement to final repayment."
        />
        <EmptyState
          icon={HandCoins}
          title="No loans yet"
          description="Loan applications submitted by members will appear here for your loan officers to review."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentRole = await getCurrentMembershipRole(groupId);
  const canReview = currentRole !== null && roleHasCapability(currentRole, "review_loan_applications");
  const today = new Date().toISOString().slice(0, 10);

  const product = await loadActiveLoanProduct(groupId);

  interface MyApplicationRow {
    id: string;
    amount_requested_minor_units: number;
    currency_code: string;
    term_months: number;
    purpose: string | null;
    status: LoanApplicationStatus;
    created_at: string;
  }

  let eligibility = computeEligibility({
    verifiedContributionsTotal: 0,
    existingOutstandingPrincipal: 0,
    policy: { enabled: false, maxLoanBpsOfContributions: 0, maxAmountMinorUnits: null, allowOverdueMembers: false },
    membershipStatus: "removed",
    hasOverdueContributions: false,
    hasOverdueRepayments: false,
  });
  let verifiedContributionsTotal = 0;
  let myApplications: MyApplicationRow[] = [];
  let myLoansDetail: MyLoanDetail[] = [];

  if (user) {
    const [eligibilityResult, myApplicationsResult, myLoansDetailResult] = await Promise.all([
      loadEligibility(groupId, user.id, product, today),
      supabase
        .from("loan_applications")
        .select("id, amount_requested_minor_units, currency_code, term_months, purpose, status, created_at")
        .eq("group_id", groupId)
        .eq("applicant_id", user.id)
        .order("created_at", { ascending: false }),
      loadMyLoansDetail(groupId, user.id, product?.gracePeriodDays ?? 0, today),
    ]);
    eligibility = eligibilityResult.eligibility;
    verifiedContributionsTotal = eligibilityResult.verifiedContributionsTotal;
    myApplications = myApplicationsResult.data ?? [];
    myLoansDetail = myLoansDetailResult;
  }

  let officerApplications: LoanApplicationRow[] = [];
  let officerLoansRaw: { loans: RawLoan[]; repayments: RawRepayment[]; names: Map<string, string> } = {
    loans: [],
    repayments: [],
    names: new Map(),
  };

  if (canReview) {
    [officerApplications, officerLoansRaw] = await Promise.all([
      loadApplicationsForOfficer(groupId),
      loadLoansForOfficer(groupId),
    ]);
  }

  const gracePeriodDays = product?.gracePeriodDays ?? 0;

  const officerLoanRows: LoanRow[] = officerLoansRaw.loans.map((loan) => {
    const loanRepayments = officerLoansRaw.repayments.filter((r) => r.loan_id === loan.id);
    return {
      id: loan.id,
      borrowerName: officerLoansRaw.names.get(loan.borrower_id) ?? "Unknown member",
      principalMinorUnits: loan.principal_minor_units,
      totalRepayableMinorUnits: loan.total_repayable_minor_units,
      currencyCode: loan.currency_code,
      outstandingPrincipalMinorUnits: outstandingPrincipal(loan.principal_minor_units, loanRepayments),
      displayStatus: toDisplayStatus(loan, loanRepayments, gracePeriodDays, today),
    };
  });

  const principalOutstanding = officerLoanRows
    .filter((l) => l.displayStatus === "active" || l.displayStatus === "overdue")
    .reduce((sum, l) => sum + l.outstandingPrincipalMinorUnits, 0);

  const interestExpected = officerLoansRaw.loans
    .filter((l) => l.status === "active")
    .reduce((sum, l) => sum + l.interest_amount_minor_units, 0);

  const interestReceived = officerLoansRaw.repayments
    .filter((r) => r.status === "verified" || r.status === "reconciled")
    .reduce((sum, r) => sum + r.interest_portion_minor_units, 0);

  const awaitingDisbursementCount = officerLoanRows.filter((l) => l.displayStatus === "awaiting_disbursement").length;
  const overdueCount = officerLoanRows.filter((l) => l.displayStatus === "overdue").length;

  const groupCurrency = product ? (officerLoansRaw.loans[0]?.currency_code ?? "GBP") : "GBP";

  const overviewContent = !product ? (
    <EmptyState
      icon={HandCoins}
      title="Set up a loan policy first"
      description="Go to Settings to configure whether loans are enabled, the borrowing limit, interest, and repayment terms for this group."
    />
  ) : (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Applications awaiting review" value={String(officerApplications.length)} icon={HandCoins} />
        <StatCard label="Awaiting disbursement" value={String(awaitingDisbursementCount)} icon={HandCoins} />
        <StatCard label="Overdue loans" value={String(overdueCount)} icon={HandCoins} />
        <StatCard label="Principal outstanding" value={formatMoney(principalOutstanding, groupCurrency)} icon={HandCoins} />
        <StatCard label="Interest expected" value={formatMoney(interestExpected, groupCurrency)} icon={HandCoins} />
        <StatCard label="Interest received" value={formatMoney(interestReceived, groupCurrency)} icon={HandCoins} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">Applications awaiting review</h2>
      {officerApplications.length === 0 ? (
        <EmptyState icon={HandCoins} title="No applications waiting" description="New loan applications will appear here." />
      ) : (
        <LoanApplicationsTable
          groupId={groupId}
          applications={officerApplications}
          defaultInterestRateBps={product.interestRateBps}
          defaultRepaymentFrequency={product.repaymentFrequency}
        />
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-foreground">Loans</h2>
      {officerLoanRows.length === 0 ? (
        <EmptyState icon={HandCoins} title="No loans yet" description="Approved and active loans will appear here." />
      ) : (
        <LoansTable groupId={groupId} loans={officerLoanRows} />
      )}
    </div>
  );

  const myContent = (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Verified contribution balance</p>
          <p className="text-lg font-semibold text-foreground">
            {formatMoney(verifiedContributionsTotal, groupCurrency)}
          </p>
        </div>
        {product ? (
          <ApplyForLoanDialog
            groupId={groupId}
            currencyCode={groupCurrency}
            eligibility={eligibility}
            verifiedContributionsTotal={verifiedContributionsTotal}
            interestRateBps={product.interestRateBps}
            repaymentFrequency={product.repaymentFrequency}
            minTermMonths={product.minTermMonths}
            maxTermMonths={product.maxTermMonths}
          />
        ) : null}
      </div>

      {myLoansDetail.length > 0 ? (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-foreground">My loans</h2>
          <div className="space-y-4">
            {myLoansDetail.map((loan) => (
              <div key={loan.id} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={loan.displayStatus === "overdue" || loan.displayStatus === "defaulted" ? "destructive" : "secondary"}>
                    {MY_LOAN_STATUS_LABELS[loan.displayStatus]}
                  </Badge>
                  {loan.nextDueDate ? (
                    <p className="text-sm text-muted-foreground">
                      Next repayment: {formatMoney(loan.nextDueAmountMinorUnits ?? 0, loan.currencyCode)} due{" "}
                      {new Date(loan.nextDueDate).toLocaleDateString("en-GB")}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Principal</p>
                    <p className="font-medium text-foreground">{formatMoney(loan.principalMinorUnits, loan.currencyCode)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total repayable</p>
                    <p className="font-medium text-foreground">{formatMoney(loan.totalRepayableMinorUnits, loan.currencyCode)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Repaid</p>
                    <p className="font-medium text-foreground">{formatMoney(loan.amountRepaidMinorUnits, loan.currencyCode)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Outstanding</p>
                    <p className="font-medium text-foreground">{formatMoney(loan.outstandingMinorUnits, loan.currencyCode)}</p>
                  </div>
                </div>
                {loan.repayments.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Repayment received</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loan.repayments.map((repayment) => (
                          <TableRow key={repayment.id}>
                            <TableCell className="text-muted-foreground">
                              {new Date(repayment.receivedAt).toLocaleDateString("en-GB")}
                            </TableCell>
                            <TableCell>{formatMoney(repayment.amountMinorUnits, loan.currencyCode)}</TableCell>
                            <TableCell className="text-muted-foreground">{repayment.status.replace(/_/g, " ")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <h2 className="mb-3 text-sm font-semibold text-foreground">My applications</h2>
      {myApplications.length === 0 ? (
        <EmptyState icon={HandCoins} title="No applications yet" description="Loan applications you submit will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Amount</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {myApplications.map((application) => (
                <TableRow key={application.id}>
                  <TableCell>{formatMoney(application.amount_requested_minor_units, application.currency_code)}</TableCell>
                  <TableCell className="text-muted-foreground">{application.term_months} months</TableCell>
                  <TableCell>
                    <Badge variant="outline">{APPLICATION_STATUS_LABELS[application.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(application.created_at).toLocaleDateString("en-GB")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Loans"
        description="Review loan applications and track active loans from disbursement to final repayment."
      />

      {canReview ? (
        <Tabs defaultValue="overview">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="mine">My loans</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">{overviewContent}</TabsContent>
          <TabsContent value="mine">{myContent}</TabsContent>
        </Tabs>
      ) : (
        myContent
      )}
    </div>
  );
}
