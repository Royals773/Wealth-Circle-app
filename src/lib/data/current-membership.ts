import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { GroupRole } from "@/lib/types/database";

/**
 * The signed-in user's own role in :groupId, or null if they aren't an
 * active member (or Supabase isn't configured). Used to decide whether
 * to show manager-only UI (e.g. the invitation panel on the Members
 * page) — this is a UI convenience, not a security boundary; the
 * underlying RPCs re-check membership and role themselves via RLS.
 */
export async function getCurrentMembershipRole(groupId: string): Promise<GroupRole | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  return data?.role ?? null;
}
