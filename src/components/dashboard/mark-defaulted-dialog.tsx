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
import { markLoanDefaultedAction } from "@/lib/actions/loans";
import { initialLoanActionState } from "@/lib/actions/action-state";

export function MarkDefaultedDialog({
  groupId,
  loanId,
  borrowerName,
  open,
  onOpenChange,
}: {
  groupId: string;
  loanId: string;
  borrowerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    markLoanDefaultedAction.bind(null, groupId),
    initialLoanActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Loan marked as defaulted</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="loanId" value={loanId} />
            <DialogHeader>
              <DialogTitle>Mark {borrowerName}&apos;s loan as defaulted</DialogTitle>
              <DialogDescription>
                Use this when repayment is genuinely not expected to continue. This can&apos;t be undone.
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
                <Label htmlFor="default-reason">Reason</Label>
                <Textarea id="default-reason" name="reason" rows={3} required maxLength={1000} />
                {state.fieldErrors?.reason ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                ) : null}
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Saving…" : "Mark as defaulted"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
