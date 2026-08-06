"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangeRoleDialog } from "@/components/dashboard/change-role-dialog";
import { SuspendMemberDialog } from "@/components/dashboard/suspend-member-dialog";
import { RemoveMemberDialog } from "@/components/dashboard/remove-member-dialog";
import { reactivateMemberAction } from "@/lib/actions/membership";
import type { GroupRole, MembershipStatus } from "@/lib/types/database";

export function MemberActionsMenu({
  groupId,
  memberId,
  memberName,
  role,
  status,
  removalBlockers,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  role: GroupRole;
  status: MembershipStatus;
  removalBlockers: string[];
}) {
  const [dialog, setDialog] = useState<"role" | "suspend" | "remove" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (role === "owner") {
    return <span className="text-xs text-muted-foreground">Transfer ownership to change</span>;
  }

  function reactivate() {
    setError(null);
    startTransition(async () => {
      const result = await reactivateMemberAction(groupId, memberId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${memberName}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {status === "active" ? (
              <>
                <DropdownMenuItem onSelect={() => setDialog("role")}>Change role</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("suspend")}>Suspend</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDialog("remove")}
                >
                  Remove
                </DropdownMenuItem>
              </>
            ) : status === "suspended" || status === "removed" ? (
              <DropdownMenuItem disabled={isPending} onSelect={reactivate}>
                {isPending ? "Reactivating…" : "Reactivate"}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ChangeRoleDialog
        groupId={groupId}
        memberId={memberId}
        memberName={memberName}
        currentRole={role}
        open={dialog === "role"}
        onOpenChange={(open) => setDialog(open ? "role" : null)}
      />
      <SuspendMemberDialog
        groupId={groupId}
        memberId={memberId}
        memberName={memberName}
        open={dialog === "suspend"}
        onOpenChange={(open) => setDialog(open ? "suspend" : null)}
      />
      <RemoveMemberDialog
        groupId={groupId}
        memberId={memberId}
        memberName={memberName}
        blockers={removalBlockers}
        open={dialog === "remove"}
        onOpenChange={(open) => setDialog(open ? "remove" : null)}
      />
    </>
  );
}
