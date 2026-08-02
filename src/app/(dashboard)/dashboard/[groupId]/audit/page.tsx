import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { loadAuditLog, type AuditDomain } from "@/lib/data/audit-summary";
import { loadBasicRoster } from "@/lib/data/member-directory";

export const metadata: Metadata = { title: "Audit log" };

type SearchParams = Record<string, string | string[] | undefined>;

function param(sp: SearchParams, key: string): string | undefined {
  const value = sp[key];
  return Array.isArray(value) ? value[0] : value || undefined;
}

const DOMAINS: AuditDomain[] = [
  "contribution",
  "loan",
  "repayment",
  "withdrawal",
  "governance",
  "membership",
  "invitation",
  "group",
  "other",
];

/** metadata is jsonb of previous/new values and reasons — see every RPC
 * in supabase/migrations/. Never contains secrets, tokens, or raw
 * credentials by construction (established since Phase 2). */
function formatMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const entries = Object.entries(metadata as Record<string, unknown>).filter(([, v]) => v !== null && v !== "");
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join(" · ");
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader title="Audit log" description="A human-readable record of sensitive actions in this group." />
        <EmptyState
          icon={ScrollText}
          title="No audit records available yet"
          description="Once your group has activity, a record of sensitive actions will appear here."
        />
      </div>
    );
  }

  const currentRole = await getCurrentMembershipRole(groupId);
  const canViewAudit = currentRole !== null && roleHasCapability(currentRole, "view_audit_log");

  if (!canViewAudit) {
    return (
      <div>
        <PageHeader title="Audit log" description="A human-readable record of sensitive actions in this group." />
        <EmptyState
          icon={ScrollText}
          title="Not available to your role"
          description="Only owners, administrators and auditors can view the audit log."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const page = Number(param(sp, "page") ?? "0") || 0;
  const filters = {
    dateFrom: param(sp, "dateFrom"),
    dateTo: param(sp, "dateTo"),
    actorId: param(sp, "actorId"),
    domain: param(sp, "domain") as AuditDomain | undefined,
    scope: param(sp, "scope") as "all" | "financial" | "governance" | undefined,
  };

  const [{ rows, hasMore }, roster] = await Promise.all([
    loadAuditLog(groupId, filters, page),
    loadBasicRoster(groupId),
  ]);

  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) exportQuery.set(key, value);
  }

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="What happened, who did it, and when — for sensitive actions across this group. Cannot be edited or deleted."
        action={
          <Button asChild variant="outline">
            <a href={`/dashboard/${groupId}/reports/export?type=audit`}>Export CSV</a>
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="dateFrom">From</Label>
              <Input type="date" id="dateFrom" name="dateFrom" defaultValue={param(sp, "dateFrom")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dateTo">To</Label>
              <Input type="date" id="dateTo" name="dateTo" defaultValue={param(sp, "dateTo")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="actorId">Actor</Label>
              <select
                id="actorId"
                name="actorId"
                defaultValue={param(sp, "actorId") ?? ""}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Anyone</option>
                {roster.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="domain">Action category</Label>
              <select
                id="domain"
                name="domain"
                defaultValue={param(sp, "domain") ?? ""}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Any</option>
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scope">Domain</Label>
              <select
                id="scope"
                name="scope"
                defaultValue={param(sp, "scope") ?? ""}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">All</option>
                <option value="financial">Financial only</option>
                <option value="governance">Governance only</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit">Apply filters</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No matching records" description="Nothing matches these filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("en-GB")}
                  </TableCell>
                  <TableCell>{r.actorName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="mr-1.5 text-xs capitalize">
                      {r.domain}
                    </Badge>
                    {r.action.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.entityType}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={formatMetadata(r.metadata)}>
                    {formatMetadata(r.metadata)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(page > 0 || hasMore) && (
        <div className="mt-6 flex items-center justify-between">
          <Button asChild variant="outline" disabled={page === 0}>
            <a href={`?${new URLSearchParams({ ...Object.fromEntries(exportQuery), page: String(Math.max(0, page - 1)) }).toString()}`}>
              Previous
            </a>
          </Button>
          <Button asChild variant="outline" disabled={!hasMore}>
            <a href={`?${new URLSearchParams({ ...Object.fromEntries(exportQuery), page: String(page + 1) }).toString()}`}>
              Next
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
