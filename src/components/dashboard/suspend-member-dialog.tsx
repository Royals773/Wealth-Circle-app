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
import { suspendMemberAction } from "@/lib/actions/membership";
import { initialMembershipActionState } from "@/lib/actions/action-state";

export function SuspendMemberDialog({
  groupId,
  memberId,
  memberName,
  open,
  onOpenChange,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    suspendMemberAction.bind(null, groupId, memberId),
    initialMembershipActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Member suspended</DialogTitle>
              <DialogDescription>
                {memberName} has been suspended and can no longer access this group until reactivated.
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
            <DialogHeader variant="destructive">
              <DialogTitle>Suspend {memberName}?</DialogTitle>
              <DialogDescription>
                They will immediately lose access to this group&apos;s data and actions. Their history is
                preserved and visible to officers. This can be reversed at any time.
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
                <Label htmlFor="suspend-reason">Reason</Label>
                <Textarea id="suspend-reason" name="reason" rows={3} required maxLength={1000} />
                {state.fieldErrors?.reason ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                ) : null}
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Suspending…" : "Suspend member"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
