import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { GroupRole, GroupStatus } from "@/lib/types/database";

export interface GroupSummary {
  id: string;
  name: string;
  role: GroupRole;
  status: GroupStatus;
}

export type DashboardContext =
  | {
      configured: false;
      groupId: string;
      currentGroup: GroupSummary;
      memberships: GroupSummary[];
    }
  | {
      configured: true;
      groupId: string;
      currentGroup: GroupSummary;
      memberships: GroupSummary[];
    };

/**
 * Resolves the current user's access to :groupId and the list of groups
 * shown in the group switcher. When Supabase isn't configured this returns
 * a single placeholder group so the dashboard structure can be reviewed
 * without a live backend — no invented financial data is included.
 */
export async function getDashboardContext(groupId: string): Promise<DashboardContext> {
  if (!isSupabaseConfigured) {
    const placeholder: GroupSummary = { id: groupId, name: "Preview group", role: "owner", status: "active" };
    return {
      configured: false,
      groupId,
      currentGroup: placeholder,
      memberships: [placeholder],
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/sign-in?next=/dashboard/${groupId}`);
  }

  const { data: rows } = await supabase
    .from("group_memberships")
    .select("group_id, role")
    .eq("user_id", user.id)
    .eq("status", "active");

  const membershipRows = rows ?? [];
  if (membershipRows.length === 0) {
    redirect("/onboarding");
  }

  const { data: groups } = await supabase
    .from("groups")
    .select("id, name, status")
    .in(
      "id",
      membershipRows.map((row) => row.group_id),
    );

  const groupById = new Map((groups ?? []).map((group) => [group.id, group]));

  const memberships: GroupSummary[] = membershipRows.map((row) => ({
    id: row.group_id,
    name: groupById.get(row.group_id)?.name ?? "Untitled group",
    role: row.role,
    status: groupById.get(row.group_id)?.status ?? "active",
  }));

  const currentGroup = memberships.find((membership) => membership.id === groupId);

  if (!currentGroup) {
    redirect(`/dashboard/${memberships[0].id}`);
  }

  return { configured: true, groupId, currentGroup, memberships };
}
