import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";

/**
 * Audit log viewer loader. audit_logs itself needs no schema change for
 * Phase 8 — every filter the spec asks for (date range, actor, target
 * type, group) is already a column; "action category" and "financial or
 * governance domain" are derived client-side from the existing `action`
 * string, not stored. RLS (audit_logs_select_managers_and_auditors)
 * already restricts this to owners/administrators/auditors — this
 * loader adds no additional access beyond what that policy already
 * grants the caller.
 */

export type AuditDomain = "contribution" | "loan" | "repayment" | "withdrawal" | "governance" | "membership" | "invitation" | "group" | "other";

const DOMAIN_PREFIXES: [string, AuditDomain][] = [
  ["contribution_", "contribution"],
  ["repayment_", "repayment"],
  ["loan_", "loan"],
  ["withdrawal_", "withdrawal"],
  ["governance_", "governance"],
  ["vote_", "governance"],
  ["ownership_transfer_", "membership"],
  ["member_", "membership"],
  ["invitation_", "invitation"],
  ["group_", "group"],
];

export function categorizeAuditAction(action: string): AuditDomain {
  for (const [prefix, domain] of DOMAIN_PREFIXES) {
    if (action.startsWith(prefix)) return domain;
  }
  return "other";
}

const FINANCIAL_DOMAINS: AuditDomain[] = ["contribution", "loan", "repayment", "withdrawal"];

export function isFinancialDomain(domain: AuditDomain): boolean {
  return FINANCIAL_DOMAINS.includes(domain);
}

export interface AuditLogRow {
  id: string;
  action: string;
  domain: AuditDomain;
  actorId: string | null;
  actorName: string;
  entityType: string;
  entityId: string | null;
  metadata: Json;
  createdAt: string;
}

export interface AuditLogFilters {
  dateFrom?: string;
  dateTo?: string;
  actorId?: string;
  entityType?: string;
  domain?: AuditDomain;
  scope?: "all" | "financial" | "governance";
}

const PAGE_SIZE = 100;

/** Domain/scope filters are derived from the `action` string, not
 * stored — so they're resolved to a concrete action list first (against
 * the small set of distinct actions actually used in this group) and
 * applied via `.in("action", ...)` at the database level, before
 * pagination. Filtering client-side after a page-limited query would
 * silently under-fill or mis-report "more results" once a domain/scope
 * filter is active. */
async function resolveActionsForDomainFilter(
  groupId: string,
  filters: Pick<AuditLogFilters, "domain" | "scope">,
): Promise<string[] | null> {
  if (!filters.domain && !filters.scope) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("audit_logs").select("action").eq("group_id", groupId);
  const distinctActions = [...new Set((data ?? []).map((r) => r.action))];

  return distinctActions.filter((action) => {
    const domain = categorizeAuditAction(action);
    if (filters.domain && domain !== filters.domain) return false;
    if (filters.scope === "financial" && !isFinancialDomain(domain)) return false;
    if (filters.scope === "governance" && domain !== "governance") return false;
    return true;
  });
}

export async function loadAuditLog(
  groupId: string,
  filters: AuditLogFilters = {},
  page = 0,
): Promise<{ rows: AuditLogRow[]; hasMore: boolean }> {
  const supabase = await createClient();
  const matchingActions = await resolveActionsForDomainFilter(groupId, filters);

  let query = supabase
    .from("audit_logs")
    .select("id, actor_id, action, entity_type, entity_id, metadata, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (matchingActions) query = query.in("action", matchingActions);

  const { data } = await query;
  const rawRows = data ?? [];

  const actorIds = [...new Set(rawRows.map((r) => r.actor_id).filter((id): id is string => Boolean(id)))];
  const { data: profiles } =
    actorIds.length > 0
      ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
      : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const rows: AuditLogRow[] = rawRows.slice(0, PAGE_SIZE).map((r) => ({
    id: r.id,
    action: r.action,
    domain: categorizeAuditAction(r.action),
    actorId: r.actor_id,
    actorName: r.actor_id ? (nameById.get(r.actor_id) ?? "Unknown") : "System",
    entityType: r.entity_type,
    entityId: r.entity_id,
    metadata: r.metadata,
    createdAt: r.created_at,
  }));

  return { rows, hasMore: rawRows.length > PAGE_SIZE };
}
