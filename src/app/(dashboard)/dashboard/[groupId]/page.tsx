import type { Metadata } from "next";
import Link from "next/link";
import { Users, HandCoins, Landmark, AlertTriangle, Wallet, History, Banknote, Vote } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import {
  loadActiveMembers,
  loadGroupContributionSummary,
  loadMemberMissedContributions,
  loadMyRecords,
} from "@/lib/data/contribution-summary";
import { loadActiveLoanProduct, loadGroupLoanSummary, loadMemberLoanEligibility } from "@/lib/data/loan-summary";
import { loadGroupWithdrawalSummary, loadMemberWithdrawalAvailability } from "@/lib/data/withdrawal-summary";
import { loadGroupProposalsWithResults } from "@/lib/data/governance-summary";
import { sumVerifiedAmount } from "@/lib/contributions";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Overview" };

async function loadGroupCurrency(groupId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle();
  return data?.currency_code ?? "GBP";
}

async function AdminDashboard({ groupId, today }: { groupId: string; today: string }) {
  const [members, contributionSummary, loanSummary, currencyCode, withdrawalSummary, proposals] = await Promise.all([
    loadActiveMembers(groupId),
    loadGroupContributionSummary(groupId, today),
    loadGroupLoanSummary(groupId, today),
    loadGroupCurrency(groupId),
    loadGroupWithdrawalSummary(groupId),
    loadGroupProposalsWithResults(groupId, null, new Date().toISOString()),
  ]);

  const openProposals = proposals.filter((p) => p.status === "open" && p.result === "voting");
  const nextDeadline = openProposals
    .slice()
    .sort((a, b) => new Date(a.voting_closes_at).getTime() - new Date(b.voting_closes_at).getTime())[0];

  const contributionCurrency = contributionSummary.plan?.currencyCode ?? currencyCode;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Group</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active members" value={String(members.length)} icon={Users} />
          <StatCard label="Overdue members" value={String(contributionSummary.overdueMemberCount)} icon={AlertTriangle} />
          <StatCard
            label="Applications awaiting review"
            value={String(loanSummary.applicationsAwaitingReviewCount)}
            icon={Landmark}
          />
          <StatCard label="Overdue loans" value={String(loanSummary.overdueCount)} icon={AlertTriangle} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Contributions</h2>
        {!contributionSummary.plan ? (
          <EmptyState
            icon={HandCoins}
            title="No contribution plan yet"
            description="Configure one in Settings to start tracking expected and received contributions."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Expected this period"
              value={formatMoney(contributionSummary.expectedTotal, contributionCurrency)}
              icon={HandCoins}
            />
            <StatCard
              label="Received"
              value={formatMoney(contributionSummary.receivedTotal, contributionCurrency)}
              icon={HandCoins}
            />
            <StatCard
              label="Outstanding this period"
              value={formatMoney(contributionSummary.outstandingTotal, contributionCurrency)}
              icon={HandCoins}
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Loans</h2>
        {!loanSummary.product ? (
          <EmptyState
            icon={Landmark}
            title="No loan policy yet"
            description="Configure one in Settings to start tracking loans for this group."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active loans" value={String(loanSummary.activeLoanCount)} icon={Landmark} />
            <StatCard
              label="Principal outstanding"
              value={formatMoney(loanSummary.principalOutstanding, loanSummary.currencyCode)}
              icon={Landmark}
            />
            <StatCard
              label="Interest expected"
              value={formatMoney(loanSummary.interestExpected, loanSummary.currencyCode)}
              icon={Landmark}
            />
            <StatCard
              label="Interest received"
              value={formatMoney(loanSummary.interestReceived, loanSummary.currencyCode)}
              icon={Landmark}
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Withdrawals</h2>
        {!withdrawalSummary.policy ? (
          <EmptyState
            icon={Banknote}
            title="No withdrawal policy yet"
            description="Configure one in Settings to start accepting withdrawal requests for this group."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Awaiting review" value={String(withdrawalSummary.awaitingReviewCount)} icon={Banknote} />
            <StatCard label="Awaiting payment" value={String(withdrawalSummary.awaitingPaymentCount)} icon={Banknote} />
            <StatCard
              label="Total pending"
              value={formatMoney(withdrawalSummary.totalPendingMinorUnits, withdrawalSummary.currencyCode)}
              icon={Banknote}
            />
            <StatCard
              label="Total paid"
              value={formatMoney(withdrawalSummary.totalPaidMinorUnits, withdrawalSummary.currencyCode)}
              icon={Banknote}
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Governance</h2>
        {proposals.length === 0 ? (
          <EmptyState
            icon={Vote}
            title="No proposals yet"
            description="Proposals raised by members for the group to vote on will appear here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Open proposals" value={String(openProposals.length)} icon={Vote} />
            <StatCard
              label="Next voting deadline"
              value={nextDeadline ? new Date(nextDeadline.voting_closes_at).toLocaleDateString("en-GB") : "None"}
              icon={Vote}
            />
          </div>
        )}
      </div>
    </div>
  );
}

async function MemberDashboard({ groupId, userId, today }: { groupId: string; userId: string; today: string }) {
  const [myRecords, missedContributions, product, withdrawalAvailability, proposals] = await Promise.all([
    loadMyRecords(groupId, userId),
    loadMemberMissedContributions(groupId, userId, today),
    loadActiveLoanProduct(groupId),
    loadMemberWithdrawalAvailability(groupId, userId, today),
    loadGroupProposalsWithResults(groupId, userId, new Date().toISOString()),
  ]);
  const { eligibility } = await loadMemberLoanEligibility(groupId, userId, product, today);

  const votableProposals = proposals.filter((p) => p.canVote);

  const verifiedTotal = sumVerifiedAmount(myRecords);
  const verifiedCount = myRecords.filter((r) => r.status === "verified" || r.status === "reconciled").length;
  const currencyCode = myRecords[0]?.currency_code ?? "GBP";
  const recent = myRecords.slice(0, 5);

  const usedPercent =
    eligibility.maxLoanAmount > 0
      ? Math.round(((eligibility.maxLoanAmount - eligibility.availableToBorrow) / eligibility.maxLoanAmount) * 100)
      : 0;

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Current balance" value={formatMoney(verifiedTotal, currencyCode)} icon={Wallet} />
        <StatCard label="Total contributions" value={String(verifiedCount)} icon={History} />
        <StatCard
          label="Available to withdraw"
          value={formatMoney(withdrawalAvailability.eligibility.availableToWithdraw, currencyCode)}
          icon={Banknote}
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Governance</h2>
        {proposals.length === 0 ? (
          <EmptyState
            icon={Vote}
            title="No proposals yet"
            description="Proposals raised for the group to vote on will appear here."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-foreground">
                {votableProposals.length > 0
                  ? `${votableProposals.length} proposal(s) awaiting your vote.`
                  : "No proposals currently awaiting your vote."}
              </p>
              <Link
                href={`/dashboard/${groupId}/governance`}
                className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
              >
                View governance →
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Loan eligibility</h2>
        <Card>
          <CardContent className="pt-6">
            {eligibility.eligible ? (
              <>
                <p className="text-sm text-muted-foreground">You&apos;re eligible to borrow up to</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">
                  {formatMoney(eligibility.availableToBorrow, currencyCode)}
                </p>
                <Progress value={usedPercent} className="mt-4" aria-label={`${usedPercent}% of borrowing limit used`} />
                <p className="mt-2 text-xs text-muted-foreground">{usedPercent}% of your limit currently borrowed</p>
                <Link
                  href={`/dashboard/${groupId}/loans`}
                  className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                >
                  Apply for a loan →
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">Not currently eligible for a loan</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {eligibility.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Missed contributions</h2>
        {missedContributions.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="Nothing missed"
            description="You're caught up on every contribution period so far."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Shortfall</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missedContributions.map((period) => (
                  <TableRow key={period.periodStart}>
                    <TableCell className="text-muted-foreground">
                      {new Date(period.periodStart).toLocaleDateString("en-GB")} –{" "}
                      {new Date(period.periodEnd).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell>{formatMoney(period.requiredAmount, currencyCode)}</TableCell>
                    <TableCell>{formatMoney(period.verifiedAmount, currencyCode)}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{formatMoney(period.shortfallAmount, currencyCode)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent contributions</h2>
          <Link href={`/dashboard/${groupId}/contributions`} className="text-sm text-primary hover:underline">
            View all →
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="No contributions yet"
            description="Once your treasurer records one for you, it will appear here."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(record.received_at).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell>{formatMoney(record.amount_minor_units, record.currency_code)}</TableCell>
                    <TableCell className="text-muted-foreground capitalize">
                      {record.status.replace(/_/g, " ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

export default async function GroupOverviewPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader title="Overview" description="A snapshot of this group's members, contributions, loans and approvals." />
        <EmptyState
          icon={Users}
          title="This preview isn't connected to a live database"
          description="Once Supabase credentials are configured, your group's real numbers will appear here."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentRole = await getCurrentMembershipRole(groupId);
  const canViewAdminDashboard = currentRole !== null && roleHasCapability(currentRole, "view_reports");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Overview"
        description={
          canViewAdminDashboard
            ? "A snapshot of this group's members, contributions, and loans."
            : "Your contributions, loan eligibility, and account status in this group."
        }
      />

      {canViewAdminDashboard ? (
        <AdminDashboard groupId={groupId} today={today} />
      ) : user ? (
        <MemberDashboard groupId={groupId} userId={user.id} today={today} />
      ) : (
        <EmptyState icon={Users} title="Sign in required" description="Sign in to see your dashboard." />
      )}
    </div>
  );
}
