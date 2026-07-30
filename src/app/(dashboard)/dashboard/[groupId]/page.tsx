import type { Metadata } from "next";
import { Users, HandCoins, Landmark, ClipboardCheck, Activity } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview" };

async function loadOverviewCounts(groupId: string) {
  if (!isSupabaseConfigured) {
    return { members: 0, pendingContributions: 0, openLoans: 0, pendingApprovals: 0 };
  }

  const supabase = await createClient();

  const [members, pendingContributions, openLoans, pendingApprovals] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("status", "active"),
    supabase
      .from("contribution_records")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("status", "pending_verification"),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("status", "active"),
    supabase
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("status", "pending"),
  ]);

  return {
    members: members.count ?? 0,
    pendingContributions: pendingContributions.count ?? 0,
    openLoans: openLoans.count ?? 0,
    pendingApprovals: pendingApprovals.count ?? 0,
  };
}

export default async function GroupOverviewPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const counts = await loadOverviewCounts(groupId);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="A snapshot of this group's members, contributions, loans and approvals."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active members" value={String(counts.members)} icon={Users} />
        <StatCard
          label="Contributions awaiting verification"
          value={String(counts.pendingContributions)}
          icon={HandCoins}
        />
        <StatCard label="Open loans" value={String(counts.openLoans)} icon={Landmark} />
        <StatCard
          label="Pending approvals"
          value={String(counts.pendingApprovals)}
          icon={ClipboardCheck}
        />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Recent activity</h2>
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Once your group starts recording contributions, loans and decisions, the most recent activity will appear here."
        />
      </div>
    </div>
  );
}
