"use client";

import { useActionState } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { cancelOwnershipTransferAction } from "@/lib/actions/membership";
import { initialMembershipActionState } from "@/lib/actions/action-state";

export function CancelTransferDialog({
  groupId,
  transferId,
  toUserName,
  open,
  onOpenChange,
}: {
  groupId: string;
  transferId: string;
  toUserName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    cancelOwnershipTransferAction.bind(null, groupId),
    initialMembershipActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Transfer cancelled</DialogTitle>
              <DialogDescription>You remain the owner of this group.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="transferId" value={transferId} />
            <DialogHeader>
              <DialogTitle>Cancel the transfer to {toUserName}?</DialogTitle>
              <DialogDescription>They will no longer be able to accept it.</DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {state.formError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{state.formError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="cancel-transfer-reason">Reason</Label>
                <Textarea id="cancel-transfer-reason" name="reason" rows={3} required maxLength={1000} />
                {state.fieldErrors?.reason ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                ) : null}
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Cancelling…" : "Cancel transfer"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
