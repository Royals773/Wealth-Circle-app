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
import { removeMemberAction } from "@/lib/actions/membership";
import { initialMembershipActionState } from "@/lib/actions/action-state";

/** Client-side blocker preview only — the RPC recomputes and enforces
 * these from scratch server-side via member_removal_blockers(). This is
 * purely so an officer doesn't fill out a whole form before finding out
 * it's blocked. */
const BLOCKER_LABELS: Record<string, string> = {
  hasActiveLoan: "an active loan",
  hasPendingLoanApplication: "a pending loan application",
  hasUnverifiedRepayment: "an unverified repayment",
  hasPendingWithdrawal: "a pending withdrawal request",
};

export function RemoveMemberDialog({
  groupId,
  memberId,
  memberName,
  blockers,
  open,
  onOpenChange,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
  blockers: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    removeMemberAction.bind(null, groupId, memberId),
    initialMembershipActionState,
  );
  const hasBlockers = blockers.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Member removed</DialogTitle>
              <DialogDescription>{memberName} has been removed from this group.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Remove {memberName}?</DialogTitle>
              <DialogDescription>
                This is reversible only by re-inviting them. Their historical records are preserved.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {hasBlockers ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {memberName} can&apos;t be removed yet. Resolve the following first:{" "}
                    {blockers.map((b) => BLOCKER_LABELS[b] ?? b).join(", ")}.
                  </AlertDescription>
                </Alert>
              ) : null}

              {state.formError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{state.formError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="remove-reason">Reason</Label>
                <Textarea id="remove-reason" name="reason" rows={3} required maxLength={1000} />
                {state.fieldErrors?.reason ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                ) : null}
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" variant="destructive" disabled={pending || hasBlockers}>
                {pending ? "Removing…" : "Remove member"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
