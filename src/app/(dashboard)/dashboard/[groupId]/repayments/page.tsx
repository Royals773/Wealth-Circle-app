import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { RecordRepaymentDialog, type LoanOption } from "@/components/dashboard/record-repayment-dialog";
import { RepaymentsTable, type RepaymentRow } from "@/components/dashboard/repayments-table";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { outstandingPrincipal } from "@/lib/loans";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Repayments" };

async function loadActiveLoanOptions(groupId: string): Promise<LoanOption[]> {
  const supabase = await createClient();
  const { data: loans } = await supabase
    .from("loans")
    .select("id, borrower_id, principal_minor_units, currency_code")
    .eq("group_id", groupId)
    .eq("status", "active");

  if (!loans || loans.length === 0) return [];

  const [{ data: repayments }, { data: profiles }] = await Promise.all([
    supabase
      .from("repayments")
      .select("loan_id, status, principal_portion_minor_units")
      .in(
        "loan_id",
        loans.map((l) => l.id),
      ),
    supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", [...new Set(loans.map((l) => l.borrower_id))]),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return loans.map((loan) => {
    const loanRepayments = (repayments ?? []).filter((r) => r.loan_id === loan.id);
    return {
      id: loan.id,
      borrowerName: nameById.get(loan.borrower_id) ?? "Unknown member",
      outstandingPrincipalMinorUnits: outstandingPrincipal(loan.principal_minor_units, loanRepayments),
      currencyCode: loan.currency_code,
    };
  });
}

async function loadRepayments(groupId: string): Promise<RepaymentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("repayments")
    .select(
      "id, loan_id, member_id, amount_minor_units, principal_portion_minor_units, interest_portion_minor_units, currency_code, received_at, payment_method, payment_reference, status",
    )
    .eq("group_id", groupId)
    .order("received_at", { ascending: false })
    .limit(200);

  if (!data || data.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...new Set(data.map((r) => r.member_id))]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return data.map((r) => ({
    id: r.id,
    borrowerName: nameById.get(r.member_id) ?? "Unknown member",
    amountMinorUnits: r.amount_minor_units,
    principalPortionMinorUnits: r.principal_portion_minor_units,
    interestPortionMinorUnits: r.interest_portion_minor_units,
    currencyCode: r.currency_code,
    receivedAt: r.received_at,
    paymentMethod: r.payment_method,
    paymentReference: r.payment_reference,
    status: r.status,
  }));
}

export default async function RepaymentsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Repayments"
          description="Track loan repayments as they're submitted, verified and reconciled."
        />
        <EmptyState
          icon={ReceiptText}
          title="No repayments recorded yet"
          description="Repayments against active loans will appear here once loans have been disbursed."
        />
      </div>
    );
  }

  const currentRole = await getCurrentMembershipRole(groupId);
  const canRecord = currentRole !== null && roleHasCapability(currentRole, "record_repayments");

  if (!canRecord) {
    return (
      <div>
        <PageHeader
          title="Repayments"
          description="Track loan repayments as they're submitted, verified and reconciled."
        />
        <EmptyState
          icon={ReceiptText}
          title="Nothing to show here"
          description="Repayment recording is handled by your group's treasurers and loan officers. You can see your own loan repayment history on the Loans page."
        />
      </div>
    );
  }

  const [loanOptions, repayments] = await Promise.all([
    loadActiveLoanOptions(groupId),
    loadRepayments(groupId),
  ]);

  const pendingCount = repayments.filter((r) => r.status === "pending_verification").length;
  const currencyCode = repayments[0]?.currencyCode ?? loanOptions[0]?.currencyCode ?? "GBP";
  const totalReceived = repayments
    .filter((r) => r.status !== "rejected" && r.status !== "reversed")
    .reduce((sum, r) => sum + r.amountMinorUnits, 0);

  return (
    <div>
      <PageHeader
        title="Repayments"
        description="Track loan repayments as they're submitted, verified and reconciled."
      />

      <div className="mb-6 flex items-center justify-end">
        {loanOptions.length > 0 ? (
          <RecordRepaymentDialog groupId={groupId} loans={loanOptions} />
        ) : null}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Awaiting verification" value={String(pendingCount)} icon={ReceiptText} />
        <StatCard label="Total received" value={formatMoney(totalReceived, currencyCode)} icon={ReceiptText} />
        <StatCard label="Active loans" value={String(loanOptions.length)} icon={ReceiptText} />
      </div>

      {repayments.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No repayments recorded yet"
          description={
            loanOptions.length === 0
              ? "Repayments can be recorded once a loan has been disbursed and is active."
              : "Record a repayment above once one has been received."
          }
        />
      ) : (
        <RepaymentsTable groupId={groupId} repayments={repayments} />
      )}
    </div>
  );
}
