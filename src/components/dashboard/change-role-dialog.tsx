"use client";

import { useActionState, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { changeMemberRoleAction } from "@/lib/actions/membership";
import { initialMembershipActionState } from "@/lib/actions/action-state";
import { ASSIGNABLE_ROLES } from "@/lib/validations/membership";
import { ROLE_LABELS } from "@/lib/permissions";
import type { GroupRole } from "@/lib/types/database";

export function ChangeRoleDialog({
  groupId,
  memberId,
  memberName,
  currentRole,
  open,
  onOpenChange,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  currentRole: GroupRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [newRole, setNewRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>(
    ASSIGNABLE_ROLES.find((r) => r !== currentRole) ?? "member",
  );
  const [state, formAction, pending] = useActionState(
    changeMemberRoleAction.bind(null, groupId, memberId),
    initialMembershipActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Role changed</DialogTitle>
              <DialogDescription>{memberName}&apos;s role has been updated.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader variant="default">
              <DialogTitle>Change {memberName}&apos;s role</DialogTitle>
              <DialogDescription>
                Currently {ROLE_LABELS[currentRole]}. Ownership can&apos;t be changed here — use
                &quot;Transfer ownership&quot; instead.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {state.formError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{state.formError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="change-role-select">New role</Label>
                <Select value={newRole} onValueChange={(value) => setNewRole(value as typeof newRole)}>
                  <SelectTrigger id="change-role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="newRole" value={newRole} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="change-role-reason">Reason</Label>
                <Textarea id="change-role-reason" name="reason" rows={3} required maxLength={1000} />
                {state.fieldErrors?.reason ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                ) : null}
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Change role"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
