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
import { initiateOwnershipTransferAction } from "@/lib/actions/membership";
import { initialMembershipActionState } from "@/lib/actions/action-state";

export function InitiateTransferDialog({
  groupId,
  eligibleMembers,
  open,
  onOpenChange,
}: {
  groupId: string;
  eligibleMembers: { userId: string; fullName: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [toUserId, setToUserId] = useState(eligibleMembers[0]?.userId ?? "");
  const [state, formAction, pending] = useActionState(
    initiateOwnershipTransferAction.bind(null, groupId),
    initialMembershipActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Transfer requested</DialogTitle>
              <DialogDescription>
                They&apos;ll need to accept before ownership actually changes. You remain the owner until
                then, and can cancel the request at any time.
              </DialogDescription>
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
              <DialogTitle>Transfer ownership</DialogTitle>
              <DialogDescription>
                You&apos;ll become an administrator once they accept. Only one transfer can be pending at a
                time.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {state.formError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{state.formError}</AlertDescription>
                </Alert>
              ) : null}

              {eligibleMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  There are no other active members to transfer ownership to.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="transfer-target">New owner</Label>
                    <Select value={toUserId} onValueChange={setToUserId}>
                      <SelectTrigger id="transfer-target">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleMembers.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input type="hidden" name="toUserId" value={toUserId} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="transfer-reason">Reason</Label>
                    <Textarea id="transfer-reason" name="reason" rows={3} required maxLength={1000} />
                    {state.fieldErrors?.reason ? (
                      <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending || eligibleMembers.length === 0}>
                {pending ? "Sending…" : "Request transfer"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
