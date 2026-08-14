"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MemberActionsMenu } from "@/components/dashboard/member-actions-menu";
import {
  PendingInvitationsList,
  type PendingInvitation,
} from "@/components/dashboard/pending-invitations-list";
import { ROLE_LABELS } from "@/lib/permissions";
import type { DirectoryMember } from "@/lib/data/member-directory";

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "removed", label: "Removed" },
] as const;

const OBLIGATION_BADGES: { key: keyof DirectoryMember; label: string }[] = [
  { key: "hasActiveLoan", label: "Active loan" },
  { key: "hasPendingLoanApplication", label: "Loan pending" },
  { key: "hasUnverifiedRepayment", label: "Repayment pending" },
  { key: "hasPendingWithdrawal", label: "Withdrawal pending" },
];

const BLOCKER_KEYS: (keyof DirectoryMember)[] = [
  "hasActiveLoan",
  "hasPendingLoanApplication",
  "hasUnverifiedRepayment",
  "hasPendingWithdrawal",
];

function removalBlockersFor(member: DirectoryMember): string[] {
  return BLOCKER_KEYS.filter((key) => member[key]).map((key) => key as string);
}

export function MemberDirectoryTable({
  groupId,
  members,
  pendingInvitations,
  currentUserId,
}: {
  groupId: string;
  members: DirectoryMember[];
  pendingInvitations: PendingInvitation[];
  currentUserId: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["value"]>("active");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return members.filter((member) => {
      if (member.status !== status) return false;
      if (!query) return true;
      return (
        member.fullName.toLowerCase().includes(query) || member.email.toLowerCase().includes(query)
      );
    });
  }, [members, search, status]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { active: 0, suspended: 0, removed: 0 };
    for (const member of members) result[member.status] = (result[member.status] ?? 0) + 1;
    result.invited = pendingInvitations.length;
    return result;
  }, [members, pendingInvitations]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(value) => setStatus(value as typeof status)}>
          <TabsList>
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label} ({counts[tab.value] ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {status !== "invited" ? (
          <Input
            placeholder="Search by name or email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="sm:max-w-xs"
          />
        ) : null}
      </div>

      {status === "invited" ? (
        pendingInvitations.length === 0 ? (
          <p className="rounded-xl border border-border bg-card shadow-sm p-6 text-center text-sm text-muted-foreground">
            No pending invitations.
          </p>
        ) : (
          <PendingInvitationsList groupId={groupId} invitations={pendingInvitations} />
        )
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-border bg-card shadow-sm p-6 text-center text-sm text-muted-foreground">
          No members match this view.
        </p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card shadow-sm sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Obligations</TableHead>
                  <TableHead>Last change</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium text-foreground">
                      {member.fullName}
                      {member.userId === currentUserId ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : null}
                      <div className="text-xs font-normal text-muted-foreground">{member.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(member.joinedAt).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {OBLIGATION_BADGES.filter((b) => member[b.key]).map((b) => (
                          <Badge key={b.label} variant="secondary" className="text-xs">
                            {b.label}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {member.lastChange
                        ? `${member.lastChange.action.replace("member_", "").replace("_", " ")} by ${member.lastChange.actorName}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {member.userId === currentUserId ? (
                        <span className="text-xs text-muted-foreground">Use &quot;Leave group&quot;</span>
                      ) : member.status === "removed" ? null : (
                        <MemberActionsMenu
                          groupId={groupId}
                          memberId={member.userId}
                          memberName={member.fullName}
                          role={member.role}
                          status={member.status}
                          removalBlockers={removalBlockersFor(member)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 sm:hidden">
            {filtered.map((member) => (
              <li key={member.userId} className="rounded-xl border border-border bg-card shadow-sm p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {member.fullName}
                      {member.userId === currentUserId ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  {member.userId !== currentUserId && member.status !== "removed" ? (
                    <MemberActionsMenu
                      groupId={groupId}
                      memberId={member.userId}
                      memberName={member.fullName}
                      role={member.role}
                      status={member.status}
                      removalBlockers={removalBlockersFor(member)}
                    />
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                  {OBLIGATION_BADGES.filter((b) => member[b.key]).map((b) => (
                    <Badge key={b.label} variant="secondary" className="text-xs">
                      {b.label}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Joined {new Date(member.joinedAt).toLocaleDateString("en-GB")}
                </p>
                {member.lastChange ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last change: {member.lastChange.action.replace("member_", "").replace("_", " ")} by{" "}
                    {member.lastChange.actorName}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
