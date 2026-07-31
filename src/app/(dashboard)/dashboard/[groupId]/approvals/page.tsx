import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { WithdrawalRequestsTable, type WithdrawalRequestRow } from "@/components/dashboard/withdrawal-requests-table";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { loadWithdrawalPolicy, WITHDRAWAL_REQUEST_COLUMNS } from "@/lib/data/withdrawal-summary";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Approvals"
          description="Sensitive actions that require sign-off from a second person before they take effect."
        />
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing awaiting approval"
          description="Withdrawal requests and other sensitive actions that need a second approver will appear here."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const currentRole = await getCurrentMembershipRole(groupId);
  const policy = await loadWithdrawalPolicy(groupId);
  const isReviewer = currentRole !== null && policy !== null && policy.reviewerRoles.includes(currentRole);

  let rows: WithdrawalRequestRow[] = [];

  if (user && isReviewer) {
    const { data: requests } = await supabase
      .from("withdrawal_requests")
      .select(WITHDRAWAL_REQUEST_COLUMNS)
      .eq("group_id", groupId)
      .in("status", ["submitted", "under_review", "awaiting_payment"])
      .neq("requested_by", user.id)
      .order("created_at", { ascending: true });

    const candidates = requests ?? [];

    // Exclude requests I've already recorded a decision on — nothing left
    // for me to do until another reviewer acts (or, for awaiting_payment,
    // I can still confirm payment even after approving it earlier).
    const { data: approvalRequests } = await supabase
      .from("approval_requests")
      .select("id, subject_id")
      .eq("group_id", groupId)
      .eq("subject_type", "withdrawal_request")
      .in(
        "subject_id",
        candidates.map((r) => r.id),
      );

    const approvalRequestIdBySubject = new Map((approvalRequests ?? []).map((ar) => [ar.subject_id, ar.id]));

    const { data: myDecisions } = await supabase
      .from("approval_decisions")
      .select("approval_request_id")
      .eq("approver_id", user.id)
      .in(
        "approval_request_id",
        [...approvalRequestIdBySubject.values()],
      );

    const decidedApprovalRequestIds = new Set((myDecisions ?? []).map((d) => d.approval_request_id));

    const actionable = candidates.filter((r) => {
      if (r.status === "awaiting_payment") return true;
      const approvalRequestId = approvalRequestIdBySubject.get(r.id);
      return approvalRequestId ? !decidedApprovalRequestIds.has(approvalRequestId) : true;
    });

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in(
        "id",
        [...new Set(actionable.map((r) => r.requested_by))],
      );
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

    rows = actionable.map((r) => ({
      id: r.id,
      requesterName: nameById.get(r.requested_by) ?? "Unknown member",
      amountMinorUnits: r.amount_minor_units,
      currencyCode: r.currency_code,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Sensitive actions that require sign-off from a second person before they take effect."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing awaiting your approval"
          description="Withdrawal requests and other sensitive actions that need your sign-off will appear here."
        />
      ) : (
        <WithdrawalRequestsTable groupId={groupId} requests={rows} />
      )}
    </div>
  );
}
