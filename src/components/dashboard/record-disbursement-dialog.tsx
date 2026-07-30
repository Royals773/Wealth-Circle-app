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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { recordDisbursementAction } from "@/lib/actions/loans";
import { initialLoanActionState } from "@/lib/actions/action-state";
import { formatMoney } from "@/lib/money";

export function RecordDisbursementDialog({
  groupId,
  loanId,
  borrowerName,
  principalMinorUnits,
  currencyCode,
  open,
  onOpenChange,
}: {
  groupId: string;
  loanId: string;
  borrowerName: string;
  principalMinorUnits: number;
  currencyCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    recordDisbursementAction.bind(null, groupId),
    initialLoanActionState,
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Disbursement recorded</DialogTitle>
              <DialogDescription>The loan is now active.</DialogDescription>
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
              <DialogTitle>Record disbursement</DialogTitle>
              <DialogDescription>
                Confirm that {formatMoney(principalMinorUnits, currencyCode)} has already been transferred to{" "}
                {borrowerName} from the group&apos;s bank account. This only records that it happened —
                WealthCircle does not move the money itself.
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
                <Label htmlFor="disbursement-date">Date transferred</Label>
                <Input
                  id="disbursement-date"
                  name="disbursementDate"
                  type="date"
                  required
                  max={today}
                  defaultValue={today}
                />
                {state.fieldErrors?.disbursementDate ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.disbursementDate}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="disbursement-reference">Bank reference (optional)</Label>
                <Input id="disbursement-reference" name="disbursementReference" type="text" maxLength={120} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="disbursement-note">Note (optional)</Label>
                <Textarea id="disbursement-note" name="disbursementNote" rows={2} maxLength={1000} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Confirm disbursement"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
