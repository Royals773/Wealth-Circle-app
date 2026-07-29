import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/permissions";
import type { GroupRole, MembershipStatus } from "@/lib/types/database";

export const metadata: Metadata = { title: "Members" };

interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  role: GroupRole;
  status: MembershipStatus;
  joinedAt: string;
}

async function loadMembers(groupId: string): Promise<MemberRow[]> {
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("id, user_id, role, status, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  if (!memberships || memberships.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in(
      "id",
      memberships.map((m) => m.user_id),
    );

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return memberships.map((membership) => ({
    id: membership.id,
    fullName: profileById.get(membership.user_id)?.full_name ?? "Unknown member",
    email: profileById.get(membership.user_id)?.email ?? "",
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joined_at,
  }));
}

export default async function MembersPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const members = await loadMembers(groupId);

  return (
    <div>
      <PageHeader
        title="Members"
        description="Everyone who belongs to this group, and the role they hold here."
      />

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          description="Members you invite during setup, or afterward, will appear here once they accept their invitation."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium text-foreground">{member.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>{ROLE_LABELS[member.role]}</TableCell>
                  <TableCell>
                    <Badge variant={member.status === "active" ? "secondary" : "outline"}>
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(member.joinedAt).toLocaleDateString()}
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
