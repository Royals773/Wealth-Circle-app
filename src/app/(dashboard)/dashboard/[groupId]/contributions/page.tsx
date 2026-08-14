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
import {
  RecordContributionDialog,
  type MemberOption,
} from "@/components/dashboard/record-contribution-dialog";
import { RecordBackdatedContributionDialog } from "@/components/dashboard/record-backdated-contribution-dialog";
import { BulkImportContributionsDialog } from "@/components/dashboard/bulk-import-contributions-dialog";
import { MyBackdatedContributions } from "@/components/dashboard/my-backdated-contributions";
import {
  ContributionRecordsTable,
  type ContributionRecordRow,
} from "@/components/dashboard/contribution-records-table";
import { MonthlyContributionStatusTable } from "@/components/dashboard/monthly-contribution-status-table";
import { ContributionFilters } from "@/components/dashboard/contribution-filters";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import {
  loadActiveMembers,
  loadGroupContributionSummary,
  loadMyRecords,
  loadPlan,
  CONTRIBUTION_RECORD_COLUMNS,
  type ActivePlan,
  type RawContributionRecord,
} from "@/lib/data/contribution-summary";
import { loadMyBackdatedContributions } from "@/lib/data/backdated-contributions";
import { getPeriodContaining } from "@/lib/contribution-periods";
import { requiredAmountForPeriod, sumVerifiedAmount } from "@/lib/contributions";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";
import type { ContributionRecordStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Contributions" };

const STATUS_LABELS: Record<ContributionRecordStatus, string> = {
  pending_verification: "Pending verification",
  verified: "Verified",
  reconciled: "Reconciled",
  rejected: "Rejected",
  reversed: "Reversed",
};

async function loadFilteredRecords(
  groupId: string,
  filters: { member?: string; status?: string; from?: string; to?: string },
): Promise<(RawContributionRecord & { memberName: string })[]> {
  const supabase = await createClient();
  let query = supabase
    .from("contribution_records")
    .select(CONTRIBUTION_RECORD_COLUMNS)
    .eq("group_id", groupId)
    .order("received_at", { ascending: false })
    .limit(200);

  if (filters.member) query = query.eq("member_id", filters.member);
  if (filters.status) query = query.eq("status", filters.status as ContributionRecordStatus);
  if (filters.from) query = query.gte("received_at", filters.from);
  if (filters.to) query = query.lte("received_at", filters.to);

  const { data } = await query;
  if (!data || data.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...new Set(data.map((r) => r.member_id))]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return data.map((r) => ({ ...r, memberName: nameById.get(r.member_id) ?? "Unknown member" }));
}

function toRecordRow(record: RawContributionRecord & { memberName: string }): ContributionRecordRow {
  return {
    id: record.id,
    memberName: record.memberName,
    amountMinorUnits: record.amount_minor_units,
    currencyCode: record.currency_code,
    periodStart: record.period_start,
    periodEnd: record.period_end,
    receivedAt: record.received_at,
    paymentMethod: record.payment_method,
    paymentReference: record.payment_reference,
    status: record.status,
  };
}

function MyContributionsTable({
  plan,
  records,
  today,
}: {
  plan: ActivePlan | null;
  records: RawContributionRecord[];
  today: string;
}) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={HandCoins}
        title="No contributions recorded yet"
        description="Once your treasurer records a contribution for you, it will appear here."
      />
    );
  }

  const verifiedTotal = sumVerifiedAmount(records);
  const pendingTotal = records
    .filter((r) => r.status === "pending_verification")
    .reduce((sum, r) => sum + r.amount_minor_units, 0);
  const currencyCode = records[0].currency_code;

  let expectedTotal = 0;
  let outstandingTotal = 0;
  if (plan) {
    const target = {
      isFlexible: plan.isFlexible,
      amountMinorUnits: plan.amountMinorUnits,
      minimumAmountMinorUnits: plan.minimumAmountMinorUnits,
    };
    // A member's join date is always <= today <= the current period's
    // end, so "was I already a member for this period" is always true
    // here — there's nothing to check beyond the plan having a required
    // amount at all.
    const currentPeriod = getPeriodContaining(plan.startDate, plan.frequency, today);
    const required = requiredAmountForPeriod(target);
    if (required !== null) {
      expectedTotal = required;
      const currentPeriodVerified = sumVerifiedAmount(
        records.filter((r) => r.period_start === currentPeriod.start),
      );
      outstandingTotal = Math.max(0, required - currentPeriodVerified);
    }
  }

  return (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Verified total" value={formatMoney(verifiedTotal, currencyCode)} icon={HandCoins} />
        <StatCard label="Pending verification" value={formatMoney(pendingTotal, currencyCode)} icon={HandCoins} />
        <StatCard
          label="Expected this period"
          value={expectedTotal > 0 ? formatMoney(expectedTotal, currencyCode) : "Flexible"}
          icon={HandCoins}
        />
        <StatCard label="Outstanding this period" value={formatMoney(outstandingTotal, currencyCode)} icon={HandCoins} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="text-muted-foreground">
                  {record.period_start ? new Date(record.period_start).toLocaleDateString("en-GB") : "—"}
                </TableCell>
                <TableCell>{formatMoney(record.amount_minor_units, record.currency_code)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(record.received_at).toLocaleDateString("en-GB")}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {record.payment_method ? PAYMENT_METHOD_LABELS[record.payment_method] : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={record.status === "rejected" || record.status === "reversed" ? "destructive" : "secondary"}>
                    {STATUS_LABELS[record.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {record.reversal_of ? "Replaces a reversed entry" : record.status === "reversed" ? "Reversed — see replacement, if any" : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default async function ContributionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ member?: string; status?: string; from?: string; to?: string }>;
}) {
  const { groupId } = await params;
  const filters = await searchParams;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Contributions"
          description="Track what each member has contributed, verify entries, and reconcile against your bank statement."
        />
        <EmptyState
          icon={HandCoins}
          title="No contributions recorded yet"
          description="Once your treasurer starts recording contributions, they'll appear here with their status — pending, verified, reconciled, or overdue."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentRole = await getCurrentMembershipRole(groupId);
  const canManage = currentRole !== null && roleHasCapability(currentRole, "record_contributions");
  const canImportHistory = currentRole !== null && roleHasCapability(currentRole, "import_historical_contributions");
  const today = new Date().toISOString().slice(0, 10);

  const myRecords = user ? await loadMyRecords(groupId, user.id) : [];
  const myBackdatedRecords = user ? await loadMyBackdatedContributions(groupId, user.id) : [];

  let plan: ActivePlan | null = null;
  let filteredRecords: (RawContributionRecord & { memberName: string })[] = [];
  let summaryPlan: ActivePlan | null = null;
  let summaryStats: Awaited<ReturnType<typeof loadGroupContributionSummary>> | null = null;
  let memberOptions: MemberOption[] = [];

  if (canManage) {
    const [summary, members] = await Promise.all([
      loadGroupContributionSummary(groupId, today),
      loadActiveMembers(groupId),
    ]);
    summaryStats = summary;
    summaryPlan = summary.plan;
    plan = summary.plan;
    memberOptions = members.map((m) => ({ id: m.userId, fullName: m.fullName }));
    filteredRecords = await loadFilteredRecords(groupId, filters);
  } else {
    plan = await loadPlan(groupId);
  }

  const overviewContent = !plan ? (
    <EmptyState
      icon={HandCoins}
      title="Set up a contribution plan first"
      description="Go to Settings to configure how contributions work for this group — fixed or flexible, amount, and frequency."
    />
  ) : (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        {canImportHistory ? (
          <>
            <BulkImportContributionsDialog groupId={groupId} />
            <RecordBackdatedContributionDialog groupId={groupId} members={memberOptions} />
          </>
        ) : null}
        <RecordContributionDialog groupId={groupId} members={memberOptions} />
      </div>

      {summaryStats ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Expected this period"
            value={formatMoney(summaryStats.expectedTotal, summaryPlan!.currencyCode)}
            icon={HandCoins}
          />
          <StatCard label="Amount received" value={formatMoney(summaryStats.receivedTotal, summaryPlan!.currencyCode)} icon={HandCoins} />
          <StatCard label="Amount verified" value={formatMoney(summaryStats.verifiedTotal, summaryPlan!.currencyCode)} icon={HandCoins} />
          <StatCard
            label="Pending verification"
            value={formatMoney(summaryStats.pendingTotal, summaryPlan!.currencyCode)}
            icon={HandCoins}
          />
          <StatCard
            label="Outstanding this period"
            value={formatMoney(summaryStats.outstandingTotal, summaryPlan!.currencyCode)}
            icon={HandCoins}
          />
          <StatCard label="Overdue members" value={String(summaryStats.overdueMemberCount)} icon={HandCoins} />
          <StatCard label="Fully paid (this period)" value={String(summaryStats.fullyPaidCount)} icon={HandCoins} />
          <StatCard label="Unpaid / partly paid (this period)" value={String(summaryStats.unpaidCount + summaryStats.partlyPaidCount)} icon={HandCoins} />
        </div>
      ) : null}

      {summaryStats && summaryStats.memberStatuses.length > 0 ? (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Monthly contribution status</h2>
          <MonthlyContributionStatusTable
            rows={
              filters.member
                ? summaryStats.memberStatuses.filter((row) => row.memberId === filters.member)
                : summaryStats.memberStatuses
            }
            currencyCode={summaryPlan!.currencyCode}
          />
        </div>
      ) : null}

      <h2 className="mb-3 text-sm font-semibold text-foreground">Recent activity</h2>
      <ContributionFilters members={memberOptions} />
      {filteredRecords.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No contributions match these filters"
          description="Try a different member, status or date range — or record a new contribution above."
        />
      ) : (
        <ContributionRecordsTable groupId={groupId} records={filteredRecords.map(toRecordRow)} />
      )}
    </div>
  );

  const myContent = (
    <div>
      <MyBackdatedContributions groupId={groupId} records={myBackdatedRecords} />
      <MyContributionsTable plan={plan} records={myRecords} today={today} />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Contributions"
        description="Track what each member has contributed, verify entries, and reconcile against your bank statement."
      />

      {canManage ? (
        <Tabs defaultValue="overview">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="mine">My contributions</TabsTrigger>
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
