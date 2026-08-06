import { createClient } from "@/lib/supabase/server";

export interface BackdatedContributionRow {
  id: string;
  amountMinorUnits: number;
  currencyCode: string;
  receivedAt: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  confirmedAt: string | null;
}

/**
 * A member's own back-dated/imported contribution history — separate
 * from contribution-summary.ts's general record loaders so the
 * existing "My contributions" table's data contract is untouched.
 * Scoped to is_backdated = true only; ordinary contributions aren't
 * duplicated here.
 */
export async function loadMyBackdatedContributions(
  groupId: string,
  userId: string,
): Promise<BackdatedContributionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contribution_records")
    .select("id, amount_minor_units, currency_code, received_at, notes, created_at, created_by, confirmed_at")
    .eq("group_id", groupId)
    .eq("member_id", userId)
    .eq("is_backdated", true)
    .order("received_at", { ascending: false });

  if (!data || data.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", [...new Set(data.map((r) => r.created_by))]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return data.map((r) => ({
    id: r.id,
    amountMinorUnits: r.amount_minor_units,
    currencyCode: r.currency_code,
    receivedAt: r.received_at,
    note: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    createdByName: nameById.get(r.created_by) ?? "An administrator",
    confirmedAt: r.confirmed_at,
  }));
}
