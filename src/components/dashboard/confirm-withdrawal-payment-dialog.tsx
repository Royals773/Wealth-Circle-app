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
import { confirmWithdrawalPaymentAction } from "@/lib/actions/withdrawals";
import { initialWithdrawalActionState } from "@/lib/actions/action-state";
import { formatMoney } from "@/lib/money";

export function ConfirmWithdrawalPaymentDialog({
  groupId,
  requestId,
  requesterName,
  amountMinorUnits,
  currencyCode,
  open,
  onOpenChange,
}: {
  groupId: string;
  requestId: string;
  requesterName: string;
  amountMinorUnits: number;
  currencyCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    confirmWithdrawalPaymentAction.bind(null, groupId),
    initialWithdrawalActionState,
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Payment recorded</DialogTitle>
              <DialogDescription>
                {requesterName}&apos;s withdrawal is now marked as paid externally.
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
            <input type="hidden" name="requestId" value={requestId} />
            <DialogHeader>
              <DialogTitle>Confirm payment to {requesterName}</DialogTitle>
              <DialogDescription>
                Only confirm this after {formatMoney(amountMinorUnits, currencyCode)} has actually been
                transferred from the group&apos;s own bank account. This is a record-keeping step —
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
                <Label htmlFor="payment-bank-reference">Bank reference</Label>
                <Input id="payment-bank-reference" name="bankReference" required maxLength={120} />
                {state.fieldErrors?.bankReference ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.bankReference}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-paid-at">Date paid</Label>
                <Input id="payment-paid-at" name="paidAt" type="date" max={today} required defaultValue={today} />
                {state.fieldErrors?.paidAt ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.paidAt}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-note">Note (optional)</Label>
                <Textarea id="payment-note" name="note" rows={2} maxLength={1000} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Confirm payment"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
