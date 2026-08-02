import type { Metadata } from "next";
import { FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { loadBasicRoster } from "@/lib/data/member-directory";
import { loadGroupFinancialOverview, loadArrearsReport, loadReconciliationExceptions } from "@/lib/data/reports-summary";
import { loadMemberStatement } from "@/lib/data/member-statement";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Reports" };

type SearchParams = Record<string, string | string[] | undefined>;

function param(sp: SearchParams, key: string): string | undefined {
  const value = sp[key];
  return Array.isArray(value) ? value[0] : value || undefined;
}

function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { groupId } = await params;
  const sp = await searchParams;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Reports"
          description="Generate summaries of contributions, loans and group finances for a given period."
        />
        <EmptyState
          icon={FileBarChart}
          title="No reports available yet"
          description="Once your group has recorded financial activity, you'll be able to generate reports here."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    currentRole,
  ] = await Promise.all([supabase.auth.getUser(), getCurrentMembershipRole(groupId)]);
  const currentUserId = user?.id ?? "";
  const canViewReports = currentRole !== null && roleHasCapability(currentRole, "view_reports");
  const canViewAudit = currentRole !== null && roleHasCapability(currentRole, "view_audit_log");
  // The group financial overview combines contribution + loan +
  // withdrawal totals, but contribution_records' RLS (Phase 3) was
  // never extended to loan_officer — only owner/administrator/
  // treasurer/auditor. A loan_officer has view_reports, but showing
  // them this combined report would silently present RLS-truncated
  // contribution figures as if they were the full group's — the same
  // class of bug as Phase 6's tally-visibility issue. Gate the overview
  // specifically to roles contribution_records' RLS actually covers;
  // loan_officer still gets everything they need from the Loans page.
  const canViewFinancialOverview =
    currentRole !== null && ["owner", "administrator", "treasurer", "auditor"].includes(currentRole);

  const period = defaultPeriod();
  const statementFrom = param(sp, "statementFrom") ?? period.start;
  const statementTo = param(sp, "statementTo") ?? period.end;
  const statementMemberId = canViewReports ? (param(sp, "statementMemberId") ?? currentUserId) : currentUserId;

  const [statement, roster] = await Promise.all([
    loadMemberStatement(groupId, statementMemberId, statementFrom, statementTo),
    canViewReports ? loadBasicRoster(groupId) : Promise.resolve([]),
  ]);

  let overview = null;
  let arrears: Awaited<ReturnType<typeof loadArrearsReport>> = [];
  let exceptions: Awaited<ReturnType<typeof loadReconciliationExceptions>> = [];

  if (canViewFinancialOverview) {
    const filters = {
      dateFrom: param(sp, "dateFrom"),
      dateTo: param(sp, "dateTo"),
      memberId: param(sp, "memberId"),
      type: param(sp, "txnType") as "contribution" | "repayment" | "withdrawal" | undefined,
      status: param(sp, "status"),
      reconciliationState: param(sp, "reconciliationState") as "reconciled" | "unreconciled" | undefined,
    };
    [overview, arrears, exceptions] = await Promise.all([
      loadGroupFinancialOverview(groupId, filters),
      loadArrearsReport(groupId),
      loadReconciliationExceptions(groupId),
    ]);
  }

  const exportQuery = new URLSearchParams();
  for (const key of ["dateFrom", "dateTo", "memberId", "txnType", "status", "reconciliationState"]) {
    const value = param(sp, key);
    if (value) exportQuery.set(key, value);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="WealthCircle ledger reports — records what's been entered in this app. WealthCircle does not connect to or independently verify your group's external bank account."
      />

      {canViewReports && !canViewFinancialOverview ? (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              The group financial overview isn&apos;t shown for your role, since it combines contribution data
              your role doesn&apos;t have full visibility into — showing a partial figure as if it were the
              group total would be misleading. Loan and repayment detail is available on the Loans page.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {canViewFinancialOverview && overview ? (
        <div className="mb-8 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Group financial overview</CardTitle>
              <CardDescription>
                Generated {new Date(overview.generatedAt).toLocaleString("en-GB")} · all figures in{" "}
                {overview.currencyCode}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Verified contributions" value={formatMoney(overview.contributions.verifiedTotal, overview.currencyCode)} />
              <Stat label="Pending contributions" value={formatMoney(overview.contributions.pendingTotal, overview.currencyCode)} />
              <Stat label="Outstanding contributions" value={formatMoney(overview.contributions.outstandingTotal, overview.currencyCode)} />
              <Stat label="Overdue members" value={String(overview.contributions.overdueMemberCount)} />
              <Stat label="Loan principal outstanding" value={formatMoney(overview.loans.principalOutstanding, overview.currencyCode)} />
              <Stat label="Interest expected" value={formatMoney(overview.loans.interestExpected, overview.currencyCode)} />
              <Stat label="Interest received" value={formatMoney(overview.loans.interestReceived, overview.currencyCode)} />
              <Stat label="Overdue loans" value={String(overview.loans.overdueCount)} />
              <Stat label="Withdrawals pending" value={formatMoney(overview.withdrawals.totalPendingMinorUnits, overview.currencyCode)} />
              <Stat label="Withdrawals paid" value={formatMoney(overview.withdrawals.totalPaidMinorUnits, overview.currencyCode)} />
              <Stat label="Reversed / corrected records" value={String(overview.reversedOrCorrectedCount)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>Applies to the transaction table and CSV export below.</CardDescription>
            </CardHeader>
            <CardContent>
              <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="dateFrom">From</Label>
                  <Input type="date" id="dateFrom" name="dateFrom" defaultValue={param(sp, "dateFrom")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dateTo">To</Label>
                  <Input type="date" id="dateTo" name="dateTo" defaultValue={param(sp, "dateTo")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="memberId">Member</Label>
                  <select
                    id="memberId"
                    name="memberId"
                    defaultValue={param(sp, "memberId") ?? ""}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">All members</option>
                    {roster.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="txnType">Transaction type</Label>
                  <select
                    id="txnType"
                    name="txnType"
                    defaultValue={param(sp, "txnType") ?? ""}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">All types</option>
                    <option value="contribution">Contributions</option>
                    <option value="repayment">Repayments</option>
                    <option value="withdrawal">Withdrawals</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="status">Status</Label>
                  <Input type="text" id="status" name="status" placeholder="e.g. verified" defaultValue={param(sp, "status")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reconciliationState">Reconciliation</Label>
                  <select
                    id="reconciliationState"
                    name="reconciliationState"
                    defaultValue={param(sp, "reconciliationState") ?? ""}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="">Any</option>
                    <option value="reconciled">Reconciled only</option>
                    <option value="unreconciled">Not yet reconciled</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button type="submit">Apply filters</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Transactions</CardTitle>
                <CardDescription>{overview.transactions.length} matching record(s)</CardDescription>
              </div>
              <Button asChild variant="outline">
                <a href={`/dashboard/${groupId}/reports/export?type=overview&${exportQuery.toString()}`}>
                  Export CSV
                </a>
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {overview.transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transactions match these filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.transactions.slice(0, 200).map((row) => (
                      <TableRow key={`${row.type}-${row.id}`}>
                        <TableCell className="text-muted-foreground">{row.date}</TableCell>
                        <TableCell className="capitalize">{row.type}</TableCell>
                        <TableCell>{row.memberName}</TableCell>
                        <TableCell>{formatMoney(row.amountMinorUnits, row.currencyCode)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {row.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {overview.transactions.length > 200 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing the first 200 of {overview.transactions.length} — use the CSV export for the complete set.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Contribution arrears</CardTitle>
                  <CardDescription>Members currently overdue on contributions or repayments</CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={`/dashboard/${groupId}/reports/export?type=arrears`}>Export CSV</a>
                </Button>
              </CardHeader>
              <CardContent>
                {arrears.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members are currently in arrears.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {arrears.map((a) => (
                      <li key={a.memberId} className="flex items-center justify-between">
                        <span>{a.memberName}</span>
                        <span className="text-muted-foreground">
                          {a.overdueContribution ? "Overdue contribution" : ""}
                          {a.overdueContribution && a.overdueRepaymentCount > 0 ? ", " : ""}
                          {a.overdueRepaymentCount > 0 ? `${a.overdueRepaymentCount} overdue loan(s)` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Reconciliation exceptions</CardTitle>
                  <CardDescription>Verified but not yet reconciled against a bank statement</CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={`/dashboard/${groupId}/reports/export?type=reconciliation`}>Export CSV</a>
                </Button>
              </CardHeader>
              <CardContent>
                {exceptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is awaiting reconciliation.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {exceptions.slice(0, 20).map((e) => (
                      <li key={`${e.type}-${e.id}`} className="flex items-center justify-between">
                        <span className="capitalize">
                          {e.type} — {e.memberName}
                        </span>
                        <span className="text-muted-foreground">{formatMoney(e.amountMinorUnits, e.currencyCode)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Other reports</CardTitle>
              <CardDescription>
                Membership and role, and governance proposal detail are already available on their own pages —
                export a CSV snapshot here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/dashboard/${groupId}/reports/export?type=membership`}>Membership &amp; role CSV</a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/dashboard/${groupId}/reports/export?type=governance`}>Governance CSV</a>
              </Button>
              {canViewAudit ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`/dashboard/${groupId}/reports/export?type=audit`}>Audit activity CSV</a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Member statement</CardTitle>
          <CardDescription>
            A WealthCircle ledger statement — not a bank statement, regulated credit statement, tax document, or
            independent financial advice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canViewReports ? (
              <div className="space-y-1.5">
                <Label htmlFor="statementMemberId">Member</Label>
                <select
                  id="statementMemberId"
                  name="statementMemberId"
                  defaultValue={statementMemberId}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {roster.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.userId === currentUserId ? `${m.fullName} (you)` : m.fullName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="statementFrom">Period start</Label>
              <Input type="date" id="statementFrom" name="statementFrom" defaultValue={statementFrom} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="statementTo">Period end</Label>
              <Input type="date" id="statementTo" name="statementTo" defaultValue={statementTo} />
            </div>
            <div className="flex items-end">
              <Button type="submit">Generate statement</Button>
            </div>
          </form>

          {statement ? (
            <div className="space-y-4 border-t border-border pt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{statement.memberName}</p>
                  <p className="text-sm text-muted-foreground">
                    {statement.periodStart} to {statement.periodEnd} · generated{" "}
                    {new Date(statement.generatedAt).toLocaleString("en-GB")}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a
                    href={`/dashboard/${groupId}/reports/export?type=statement&statementMemberId=${statement.memberId}&statementFrom=${statement.periodStart}&statementTo=${statement.periodEnd}`}
                  >
                    Export CSV
                  </a>
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Stat label="Opening balance" value={formatMoney(statement.openingBalanceMinorUnits, statement.currencyCode)} />
                <Stat label="Closing balance" value={formatMoney(statement.closingBalanceMinorUnits, statement.currencyCode)} />
                <Stat label="Outstanding loans" value={formatMoney(statement.outstandingLoansMinorUnits, statement.currencyCode)} />
                <Stat label="Pending transactions" value={String(statement.pendingTransactions.length)} />
              </div>

              <StatementSection title="Contributions" lines={statement.contributionsInPeriod} currencyCode={statement.currencyCode} />
              <StatementSection title="Withdrawals" lines={statement.withdrawalsInPeriod} currencyCode={statement.currencyCode} />
              <StatementSection title="Loan disbursements" lines={statement.loanDisbursementsInPeriod} currencyCode={statement.currencyCode} />
              <StatementSection title="Repayments" lines={statement.repaymentsInPeriod} currencyCode={statement.currencyCode} />
              <StatementSection title="Reversals and corrections" lines={statement.reversalsInPeriod} currencyCode={statement.currencyCode} />
              <StatementSection title="Pending (not yet in the balance above)" lines={statement.pendingTransactions} currencyCode={statement.currencyCode} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Statement unavailable.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function StatementSection({
  title,
  lines,
  currencyCode,
}: {
  title: string;
  lines: { id: string; date: string; description: string; amountMinorUnits: number; status: string }[];
  currencyCode: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <ul className="space-y-1 text-sm">
        {lines.map((line) => (
          <li key={line.id} className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>
              {line.date} — {line.description}
            </span>
            <span className="shrink-0 text-foreground">{formatMoney(line.amountMinorUnits, currencyCode)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
