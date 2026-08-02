import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { toCsv, type CsvTable } from "@/lib/csv";
import { loadGroupFinancialOverview, loadArrearsReport, loadReconciliationExceptions } from "@/lib/data/reports-summary";
import { loadMemberStatement } from "@/lib/data/member-statement";
import { loadMemberDirectory } from "@/lib/data/member-directory";
import { loadGroupProposals } from "@/lib/data/governance-summary";
import { loadAuditLog } from "@/lib/data/audit-summary";
import { ROLE_LABELS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";

/**
 * CSV export for every report type on the Reports page. A Route
 * Handler, not a Server Action, because a real file download needs a
 * genuine HTTP response with Content-Disposition — every check here
 * mirrors what the page itself already gates on (auth, role
 * capability), and every report is regenerated from the same loaders
 * the on-screen version uses, never a client-supplied precomputed
 * total. Logs an audit_logs row (`report_export_generated`) before
 * streaming the response.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type") ?? "overview";

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const currentRole = await getCurrentMembershipRole(groupId);

  if (type === "statement") {
    const statementMemberId = searchParams.get("statementMemberId") ?? user.id;
    const canViewReports = currentRole !== null && roleHasCapability(currentRole, "view_reports");
    if (statementMemberId !== user.id && !canViewReports) {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    }

    const from = searchParams.get("statementFrom");
    const to = searchParams.get("statementTo");
    if (!from || !to) return NextResponse.json({ error: "Missing period" }, { status: 400 });

    const statement = await loadMemberStatement(groupId, statementMemberId, from, to);
    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const table: CsvTable = {
      headers: ["Section", "Date", "Description", "Amount", "Status"],
      rows: [
        ["Opening balance", statement.periodStart, "", formatMoney(statement.openingBalanceMinorUnits, statement.currencyCode), ""],
        ...statement.contributionsInPeriod.map((l) => ["Contribution", l.date, l.description, formatMoney(l.amountMinorUnits, statement.currencyCode), l.status]),
        ...statement.withdrawalsInPeriod.map((l) => ["Withdrawal", l.date, l.description, formatMoney(l.amountMinorUnits, statement.currencyCode), l.status]),
        ...statement.loanDisbursementsInPeriod.map((l) => ["Loan disbursement", l.date, l.description, formatMoney(l.amountMinorUnits, statement.currencyCode), l.status]),
        ...statement.repaymentsInPeriod.map((l) => ["Repayment", l.date, l.description, formatMoney(l.amountMinorUnits, statement.currencyCode), l.status]),
        ...statement.reversalsInPeriod.map((l) => ["Reversal/correction", l.date, l.description, formatMoney(l.amountMinorUnits, statement.currencyCode), l.status]),
        ...statement.pendingTransactions.map((l) => ["Pending", l.date, l.description, formatMoney(l.amountMinorUnits, statement.currencyCode), l.status]),
        ["Closing balance", statement.periodEnd, "", formatMoney(statement.closingBalanceMinorUnits, statement.currencyCode), ""],
      ],
    };

    return streamCsv(table, {
      "Report type": "Member statement — WealthCircle ledger statement (not a bank statement)",
      Member: statement.memberName,
      Period: `${statement.periodStart} to ${statement.periodEnd}`,
      "Generated at": statement.generatedAt,
    }, groupId, user.id, "member_statement");
  }

  const canViewReports = currentRole !== null && roleHasCapability(currentRole, "view_reports");
  const canViewAudit = currentRole !== null && roleHasCapability(currentRole, "view_audit_log");
  if (!canViewReports) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }
  // contribution_records' RLS (Phase 3) was never extended to
  // loan_officer — only owner/administrator/treasurer/auditor. Any
  // report combining contribution data would silently under-report for
  // that role rather than erroring; see reports/page.tsx's
  // canViewFinancialOverview comment for the full reasoning.
  const canViewFinancialOverview =
    currentRole !== null && ["owner", "administrator", "treasurer", "auditor"].includes(currentRole);

  if (["overview", "arrears", "reconciliation"].includes(type) && !canViewFinancialOverview) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  }

  if (type === "overview") {
    const overview = await loadGroupFinancialOverview(groupId, {
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      memberId: searchParams.get("memberId") ?? undefined,
      type: (searchParams.get("txnType") ?? undefined) as "contribution" | "repayment" | "withdrawal" | undefined,
      status: searchParams.get("status") ?? undefined,
      reconciliationState: (searchParams.get("reconciliationState") ?? undefined) as "reconciled" | "unreconciled" | undefined,
    });
    const table: CsvTable = {
      headers: ["Date", "Type", "Member", "Amount", "Currency", "Status"],
      rows: overview.transactions.map((r) => [r.date, r.type, r.memberName, r.amountMinorUnits / 100, r.currencyCode, r.status]),
    };
    return streamCsv(table, {
      "Report type": "Group financial overview",
      "Generated at": overview.generatedAt,
      Currency: overview.currencyCode,
    }, groupId, user.id, "financial_overview");
  }

  if (type === "arrears") {
    const rows = await loadArrearsReport(groupId);
    const table: CsvTable = {
      headers: ["Member", "Overdue contribution", "Overdue loan repayments"],
      rows: rows.map((r) => [r.memberName, r.overdueContribution ? "Yes" : "No", r.overdueRepaymentCount]),
    };
    return streamCsv(table, { "Report type": "Contribution and repayment arrears" }, groupId, user.id, "arrears");
  }

  if (type === "reconciliation") {
    const rows = await loadReconciliationExceptions(groupId);
    const table: CsvTable = {
      headers: ["Type", "Member", "Amount", "Status", "Date"],
      rows: rows.map((r) => [r.type, r.memberName, formatMoney(r.amountMinorUnits, r.currencyCode), r.status, r.date]),
    };
    return streamCsv(table, { "Report type": "Reconciliation exceptions" }, groupId, user.id, "reconciliation_exceptions");
  }

  if (type === "membership") {
    const rows = await loadMemberDirectory(groupId);
    const table: CsvTable = {
      headers: ["Name", "Email", "Role", "Status", "Joined"],
      rows: rows.map((m) => [m.fullName, m.email, ROLE_LABELS[m.role], m.status, m.joinedAt]),
    };
    return streamCsv(table, { "Report type": "Membership and role" }, groupId, user.id, "membership");
  }

  if (type === "governance") {
    const rows = await loadGroupProposals(groupId);
    const table: CsvTable = {
      headers: ["Title", "Category", "Status", "Voting opens", "Voting closes", "Approval threshold %"],
      rows: rows.map((p) => [p.title, p.category ?? "", p.status, p.voting_opens_at, p.voting_closes_at, p.approval_threshold_percent]),
    };
    return streamCsv(table, { "Report type": "Governance proposals" }, groupId, user.id, "governance");
  }

  if (type === "audit") {
    if (!canViewAudit) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    const { rows } = await loadAuditLog(groupId, {}, 0);
    const table: CsvTable = {
      headers: ["When", "Actor", "Action", "Domain", "Target type", "Target ID"],
      rows: rows.map((r) => [r.createdAt, r.actorName, r.action, r.domain, r.entityType, r.entityId ?? ""]),
    };
    return streamCsv(table, { "Report type": "Audit activity" }, groupId, user.id, "audit_activity");
  }

  return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
}

async function streamCsv(
  table: CsvTable,
  metadata: Record<string, string>,
  groupId: string,
  actorId: string,
  reportType: string,
): Promise<NextResponse> {
  const { csv } = toCsv(table, metadata);

  const supabase = await createClient();
  await supabase.from("audit_logs").insert({
    group_id: groupId,
    actor_id: actorId,
    action: "report_export_generated",
    entity_type: "report",
    entity_id: null,
    metadata: { report_type: reportType },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="wealthcircle-${reportType}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
