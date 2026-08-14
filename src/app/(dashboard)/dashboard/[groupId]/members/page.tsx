import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InviteMemberDialog } from "@/components/dashboard/invite-member-dialog";
import { MemberDirectoryTable } from "@/components/dashboard/member-directory-table";
import { OwnershipTransferCard } from "@/components/dashboard/ownership-transfer-card";
import type { PendingInvitation } from "@/components/dashboard/pending-invitations-list";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import {
  loadBasicRoster,
  loadMemberDirectory,
  loadPendingOwnershipTransfer,
} from "@/lib/data/member-directory";
import { ROLE_LABELS, roleHasCapability } from "@/lib/permissions";

export const metadata: Metadata = { title: "Members" };

async function loadPendingInvitations(groupId: string): Promise<PendingInvitation[]> {
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("group_invitations")
    .select("id, email, role, expires_at")
    .eq("group_id", groupId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
  }));
}

export default async function MembersPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader title="Members" description="Everyone who belongs to this group." />
        <EmptyState
          icon={Users}
          title="No members yet"
          description="Members you invite during setup, or afterward, will appear here once they accept their invitation."
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
  const canManageMembers = currentRole !== null && roleHasCapability(currentRole, "manage_members");
  const isOwner = currentRole === "owner";

  if (!canManageMembers) {
    const roster = await loadBasicRoster(groupId);

    return (
      <div>
        <PageHeader
          title="Members"
          description="Everyone who belongs to this group, and the role they hold here."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/${groupId}/members/apply`}>Complete member profile</Link>
            </Button>
          }
        />

        {roster.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No members yet"
            description="Members will appear here once they accept an invitation."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium text-foreground">
                      {member.fullName}
                      {member.userId === currentUserId ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.status === "active" ? "secondary" : "outline"}>
                        {member.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(member.joinedAt).toLocaleDateString("en-GB")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }

  const [members, pendingInvitations, pendingTransfer] = await Promise.all([
    loadMemberDirectory(groupId),
    loadPendingInvitations(groupId),
    loadPendingOwnershipTransfer(groupId),
  ]);

  const eligibleTransferTargets = members
    .filter((m) => m.status === "active" && m.role !== "owner" && m.userId !== currentUserId)
    .map((m) => ({ userId: m.userId, fullName: m.fullName }));

  return (
    <div>
      <PageHeader
        title="Members"
        description="Manage roles, suspensions, removals, and ownership for this group."
        action={<InviteMemberDialog groupId={groupId} />}
      />

      <div className="mb-6">
        <OwnershipTransferCard
          groupId={groupId}
          currentUserId={currentUserId}
          isOwner={isOwner}
          pendingTransfer={pendingTransfer}
          eligibleMembers={eligibleTransferTargets}
        />
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          description="Members you invite during setup, or afterward, will appear here once they accept their invitation."
        />
      ) : (
        <MemberDirectoryTable
          groupId={groupId}
          members={members}
          pendingInvitations={pendingInvitations}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}
