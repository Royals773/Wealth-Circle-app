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
import {
  ContributionRecordsTable,
  type ContributionRecordRow,
} from "@/components/dashboard/contribution-records-table";
import { ContributionFilters } from "@/components/dashboard/contribution-filters";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { getPeriodContaining, listPeriodsBetween } from "@/lib/contribution-periods";
import {
  computeMemberPeriodStatus,
  requiredAmountForPeriod,
  sumVerifiedAmount,
  type MemberPeriodStatus,
} from "@/lib/contributions";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";
import type {
  ContributionFrequency,
  ContributionRecordStatus,
  PaymentMethod,
} from "@/lib/types/database";

export const metadata: Metadata = { title: "Contributions" };

interface ActivePlan {
  id: string;
  isFlexible: boolean;
  amountMinorUnits: number | null;
  minimumAmountMinorUnits: number | null;
  frequency: ContributionFrequency;
  startDate: string;
  currencyCode: string;
}

interface ActiveMember {
  userId: string;
  fullName: string;
  joinedAt: string;
}

interface RawRecord {
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

const RECORD_COLUMNS =
  "id, member_id, amount_minor_units, currency_code, period_start, period_end, received_at, payment_method, payment_reference, status, reversal_of";

const STATUS_LABELS: Record<ContributionRecordStatus, string> = {
  pending_verification: "Pending verification",
  verified: "Verified",
  reconciled: "Reconciled",
  rejected: "Rejected",
  reversed: "Reversed",
};

async function loadPlan(groupId: string): Promise<ActivePlan | null> {
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

async function loadActiveMembers(groupId: string): Promise<ActiveMember[]> {
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

async function loadAllRecords(groupId: string): Promise<RawRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("contribution_records").select(RECORD_COLUMNS).eq("group_id", groupId);
  return data ?? [];
}

async function loadFilteredRecords(
  groupId: string,
  filters: { member?: string; status?: string; from?: string; to?: string },
): Promise<(RawRecord & { memberName: string })[]> {
  const supabase = await createClient();
  let query = supabase
    .from("contribution_records")
    .select(RECORD_COLUMNS)
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

async function loadMyRecords(groupId: string, userId: string): Promise<RawRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contribution_records")
    .select(RECORD_COLUMNS)
    .eq("group_id", groupId)
    .eq("member_id", userId)
    .order("received_at", { ascending: false });
  return data ?? [];
}

interface OverviewStats {
  expectedTotal: number;
  receivedTotal: number;
  verifiedTotal: number;
  pendingTotal: number;
  outstandingTotal: number;
  overdueMemberCount: number;
  fullyPaidCount: number;
  partlyPaidCount: number;
  unpaidCount: number;
}

function computeOverviewStats(plan: ActivePlan, members: ActiveMember[], allRecords: RawRecord[], today: string): OverviewStats {
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
    expectedTotal,
    receivedTotal,
    verifiedTotal,
    pendingTotal,
    outstandingTotal: Math.max(0, expectedTotal - currentPeriodVerifiedTotal),
    overdueMemberCount: overdueMemberIds.size,
    fullyPaidCount,
    partlyPaidCount,
    unpaidCount,
  };
}

function toRecordRow(record: RawRecord & { memberName: string }): ContributionRecordRow {
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
  joinedAt,
  today,
}: {
  plan: ActivePlan | null;
  records: RawRecord[];
  joinedAt: string;
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
    const currentPeriod = getPeriodContaining(plan.startDate, plan.frequency, today);
    const required = requiredAmountForPeriod(target);
    if (required !== null && joinedAt <= currentPeriod.end) {
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

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
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
                  {record.period_start ? new Date(record.period_start).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell>{formatMoney(record.amount_minor_units, record.currency_code)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(record.received_at).toLocaleDateString()}
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
  const today = new Date().toISOString().slice(0, 10);

  const myRecords = user ? await loadMyRecords(groupId, user.id) : [];

  let plan: ActivePlan | null = null;
  let members: ActiveMember[] = [];
  let allRecords: RawRecord[] = [];
  let filteredRecords: (RawRecord & { memberName: string })[] = [];
  let stats: OverviewStats | null = null;

  if (canManage) {
    [plan, members, allRecords] = await Promise.all([
      loadPlan(groupId),
      loadActiveMembers(groupId),
      loadAllRecords(groupId),
    ]);
    filteredRecords = await loadFilteredRecords(groupId, filters);
    if (plan) stats = computeOverviewStats(plan, members, allRecords, today);
  } else {
    plan = await loadPlan(groupId);
  }

  const myJoinedAt = members.find((m) => m.userId === user?.id)?.joinedAt ?? today;

  const memberOptions: MemberOption[] = members.map((m) => ({ id: m.userId, fullName: m.fullName }));

  const overviewContent = !plan ? (
    <EmptyState
      icon={HandCoins}
      title="Set up a contribution plan first"
      description="Go to Settings to configure how contributions work for this group — fixed or flexible, amount, and frequency."
    />
  ) : (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <RecordContributionDialog groupId={groupId} members={memberOptions} />
      </div>

      {stats ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Expected this period"
            value={formatMoney(stats.expectedTotal, plan.currencyCode)}
            icon={HandCoins}
          />
          <StatCard label="Amount received" value={formatMoney(stats.receivedTotal, plan.currencyCode)} icon={HandCoins} />
          <StatCard label="Amount verified" value={formatMoney(stats.verifiedTotal, plan.currencyCode)} icon={HandCoins} />
          <StatCard
            label="Pending verification"
            value={formatMoney(stats.pendingTotal, plan.currencyCode)}
            icon={HandCoins}
          />
          <StatCard
            label="Outstanding this period"
            value={formatMoney(stats.outstandingTotal, plan.currencyCode)}
            icon={HandCoins}
          />
          <StatCard label="Overdue members" value={String(stats.overdueMemberCount)} icon={HandCoins} />
          <StatCard label="Fully paid (this period)" value={String(stats.fullyPaidCount)} icon={HandCoins} />
          <StatCard label="Unpaid / partly paid (this period)" value={String(stats.unpaidCount + stats.partlyPaidCount)} icon={HandCoins} />
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
    <MyContributionsTable plan={plan} records={myRecords} joinedAt={myJoinedAt} today={today} />
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
