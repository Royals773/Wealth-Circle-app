import type { Metadata } from "next";
import { Banknote } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RequestWithdrawalDialog } from "@/components/dashboard/request-withdrawal-dialog";
import { WithdrawalRequestsTable, type WithdrawalRequestRow } from "@/components/dashboard/withdrawal-requests-table";
import { MyWithdrawalRequestsTable, type MyWithdrawalRequestRow } from "@/components/dashboard/my-withdrawal-requests-table";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import {
  loadGroupWithdrawalSummary,
  loadMemberWithdrawalAvailability,
  loadMyWithdrawalRequests,
  loadWithdrawalPolicy,
} from "@/lib/data/withdrawal-summary";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Withdrawals" };

async function loadGroupCurrency(groupId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("groups").select("currency_code").eq("id", groupId).maybeSingle();
  return data?.currency_code ?? "GBP";
}

export default async function WithdrawalsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Withdrawals"
          description="Requests to withdraw funds from the group's bank account, with configurable approval before payment."
        />
        <EmptyState
          icon={Banknote}
          title="No withdrawal requests yet"
          description="When a member requests a withdrawal, it will appear here awaiting review."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentRole = await getCurrentMembershipRole(groupId);
  const today = new Date().toISOString().slice(0, 10);

  const policy = await loadWithdrawalPolicy(groupId);
  const isReviewer = currentRole !== null && policy !== null && policy.reviewerRoles.includes(currentRole);

  const summary = isReviewer ? await loadGroupWithdrawalSummary(groupId) : null;
  const groupCurrency = summary?.currencyCode ?? (await loadGroupCurrency(groupId));

  let requestRows: WithdrawalRequestRow[] = [];
  if (summary) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in(
        "id",
        [...new Set(summary.requests.map((r) => r.requested_by))],
      );
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
    requestRows = summary.requests.map((r) => ({
      id: r.id,
      requesterName: nameById.get(r.requested_by) ?? "Unknown member",
      amountMinorUnits: r.amount_minor_units,
      currencyCode: r.currency_code,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  let availability: Awaited<ReturnType<typeof loadMemberWithdrawalAvailability>> | null = null;
  let myRequests: MyWithdrawalRequestRow[] = [];
  let reservedAmount = 0;

  if (user) {
    const [availabilityResult, myRequestsRaw] = await Promise.all([
      loadMemberWithdrawalAvailability(groupId, user.id, today),
      loadMyWithdrawalRequests(groupId, user.id),
    ]);
    availability = availabilityResult;
    reservedAmount = myRequestsRaw
      .filter((r) => ["submitted", "under_review", "approved", "awaiting_payment"].includes(r.status))
      .reduce((sum, r) => sum + r.amount_minor_units, 0);
    myRequests = myRequestsRaw.map((r) => ({
      id: r.id,
      amountMinorUnits: r.amount_minor_units,
      currencyCode: r.currency_code,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      paidAmountMinorUnits: r.paid_amount_minor_units,
      paymentDate: r.payment_date,
      paidBankReference: r.paid_bank_reference,
    }));
  }

  const overviewContent = !summary || !summary.policy ? (
    <EmptyState
      icon={Banknote}
      title="Set up a withdrawal policy first"
      description="Go to Settings to configure whether withdrawals are enabled, amount limits, and how many approvals are required."
    />
  ) : (
    <div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting review" value={String(summary.awaitingReviewCount)} icon={Banknote} />
        <StatCard label="Under review" value={String(summary.underReviewCount)} icon={Banknote} />
        <StatCard label="Awaiting payment" value={String(summary.awaitingPaymentCount)} icon={Banknote} />
        <StatCard
          label="Total pending"
          value={formatMoney(summary.totalPendingMinorUnits, summary.currencyCode)}
          icon={Banknote}
        />
        <StatCard
          label="Total paid"
          value={formatMoney(summary.totalPaidMinorUnits, summary.currencyCode)}
          icon={Banknote}
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">Requests</h2>
      {requestRows.length === 0 ? (
        <EmptyState icon={Banknote} title="No requests yet" description="Withdrawal requests will appear here." />
      ) : (
        <WithdrawalRequestsTable groupId={groupId} requests={requestRows} />
      )}
    </div>
  );

  const myContent = (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Available to withdraw</p>
          <p className="text-lg font-semibold text-foreground">
            {formatMoney(availability?.eligibility.availableToWithdraw ?? 0, groupCurrency)}
          </p>
        </div>
        {policy && availability ? (
          <RequestWithdrawalDialog
            groupId={groupId}
            currencyCode={groupCurrency}
            eligibility={availability.eligibility}
            reservedAmount={reservedAmount}
            noticePeriodDays={policy.noticePeriodDays}
            requiredApprovals={policy.requiredApprovals}
          />
        ) : null}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-foreground">My withdrawal requests</h2>
      {myRequests.length === 0 ? (
        <EmptyState
          icon={Banknote}
          title="No withdrawal requests yet"
          description="Requests you submit will appear here, tracked through review, approval and payment."
        />
      ) : (
        <MyWithdrawalRequestsTable groupId={groupId} requests={myRequests} />
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Withdrawals"
        description="Requests to withdraw funds from the group's bank account, with configurable approval before payment."
      />

      {isReviewer ? (
        <Tabs defaultValue="overview">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="mine">My withdrawals</TabsTrigger>
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
