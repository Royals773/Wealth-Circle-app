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
import { LoanApplicationsTable } from "@/components/dashboard/loan-applications-table";
import { LoansTable } from "@/components/dashboard/loans-table";
import { LendingDisabledNotice } from "@/components/dashboard/lending-disabled-notice";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { LENDING_DISABLED } from "@/lib/lending-gate";
import { computeEligibility } from "@/lib/loan-eligibility";
import {
  loadActiveLoanProduct,
  loadGroupLoanSummary,
  loadMemberLoanEligibility,
  loadMyLoansDetail,
  type ActiveLoanProduct,
  type MyLoanDetail,
} from "@/lib/data/loan-summary";
import { formatMoney } from "@/lib/money";
import type { LoanDisplayStatus } from "@/lib/loans";
import type { LoanApplicationStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Loans" };

const LOANS_UNAVAILABLE_MESSAGE =
  "Lending is currently unavailable. Loan applications cannot be submitted while lending is disabled.";

interface MyApplicationRow {
  id: string;
  amount_requested_minor_units: number;
  currency_code: string;
  term_months: number;
  purpose: string | null;
  status: LoanApplicationStatus;
  created_at: string;
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

async function loadGroupCurrency(groupId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle();
  return data?.currency_code ?? "GBP";
}

export default async function LoansPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Loans"
          description="Review loan applications and track active loans from disbursement to final repayment."
        />
        {LENDING_DISABLED ? (
          <div className="mb-6">
            <LendingDisabledNotice message={LOANS_UNAVAILABLE_MESSAGE} />
          </div>
        ) : null}
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

  const summary = canReview ? await loadGroupLoanSummary(groupId, today) : null;
  let product: ActiveLoanProduct | null = summary?.product ?? null;
  let groupCurrency: string = summary?.currencyCode ?? "GBP";

  if (!canReview) {
    [product, groupCurrency] = await Promise.all([loadActiveLoanProduct(groupId), loadGroupCurrency(groupId)]);
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
      loadMemberLoanEligibility(groupId, user.id, product, today),
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

  const overviewContent = !summary || !summary.product ? (
    <EmptyState
      icon={HandCoins}
      title="Set up a loan policy first"
      description="Go to Settings to configure whether loans are enabled, the borrowing limit, interest, and repayment terms for this group."
    />
  ) : (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Applications awaiting review"
          value={String(summary.applicationsAwaitingReviewCount)}
          icon={HandCoins}
        />
        <StatCard label="Awaiting disbursement" value={String(summary.awaitingDisbursementCount)} icon={HandCoins} />
        <StatCard label="Overdue loans" value={String(summary.overdueCount)} icon={HandCoins} />
        <StatCard
          label="Principal outstanding"
          value={formatMoney(summary.principalOutstanding, summary.currencyCode)}
          icon={HandCoins}
        />
        <StatCard
          label="Interest expected"
          value={formatMoney(summary.interestExpected, summary.currencyCode)}
          icon={HandCoins}
        />
        <StatCard
          label="Interest received"
          value={formatMoney(summary.interestReceived, summary.currencyCode)}
          icon={HandCoins}
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">Applications awaiting review</h2>
      {summary.applications.length === 0 ? (
        <EmptyState icon={HandCoins} title="No applications waiting" description="New loan applications will appear here." />
      ) : (
        <LoanApplicationsTable
          groupId={groupId}
          applications={summary.applications}
          defaultInterestRateBps={summary.product.interestRateBps}
          defaultRepaymentFrequency={summary.product.repaymentFrequency}
        />
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-foreground">Loans</h2>
      {summary.loanRows.length === 0 ? (
        <EmptyState icon={HandCoins} title="No loans yet" description="Approved and active loans will appear here." />
      ) : (
        <LoansTable groupId={groupId} loans={summary.loanRows} />
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
              <div key={loan.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
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
        <EmptyState
          icon={HandCoins}
          title="No applications yet"
          description={
            LENDING_DISABLED
              ? "No applications can be submitted while lending is disabled."
              : "Loan applications you submit will appear here."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
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

      {LENDING_DISABLED ? (
        <div className="mb-6">
          <LendingDisabledNotice message={LOANS_UNAVAILABLE_MESSAGE} />
        </div>
      ) : null}

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
