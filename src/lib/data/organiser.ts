import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { OrganiserApplicationStatus } from "@/lib/types/database";

export interface MyOrganiserApplication {
  status: OrganiserApplicationStatus;
  submittedAt: string;
  decisionReason: string | null;
}

/**
 * The signed-in user's own current organiser application, if any.
 * organiser_applications_select_self (RLS) already scopes this to the
 * caller — this loader is purely for display convenience. "Current" is
 * the most recent row, matching the same definition is_organiser_approved()
 * and the decision RPCs use in the database (see
 * 0024_phase10_platform_authorisation.sql).
 */
export async function loadMyOrganiserApplication(): Promise<MyOrganiserApplication | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("organiser_applications")
    .select("status, submitted_at, decision_reason")
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { status: data.status, submittedAt: data.submitted_at, decisionReason: data.decision_reason };
}
