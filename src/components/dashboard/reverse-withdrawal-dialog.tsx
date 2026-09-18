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
import { reverseWithdrawalPaymentAction } from "@/lib/actions/withdrawals";
import { initialWithdrawalActionState } from "@/lib/actions/action-state";
import { formatMoney } from "@/lib/money";

export function ReverseWithdrawalDialog({
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
    reverseWithdrawalPaymentAction.bind(null, groupId),
    initialWithdrawalActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Payment reversed</DialogTitle>
              <DialogDescription>
                {requesterName}&apos;s withdrawal is now marked as reversed. The original record is kept,
                not deleted.
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
            <DialogHeader variant="destructive">
              <DialogTitle>Reverse payment to {requesterName}</DialogTitle>
              <DialogDescription>
                Use this only if the {formatMoney(amountMinorUnits, currencyCode)} payment was recorded in
                error. The original record stays in the audit trail, marked as reversed.
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
                <Label htmlFor="reverse-withdrawal-reason">Reason</Label>
                <Textarea id="reverse-withdrawal-reason" name="reason" rows={3} required maxLength={500} />
                {state.fieldErrors?.reason ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                ) : null}
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Saving…" : "Reverse payment"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
