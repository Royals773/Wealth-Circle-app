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
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { decideWithdrawalRequestAction } from "@/lib/actions/withdrawals";
import { initialWithdrawalActionState } from "@/lib/actions/action-state";
import { formatMoney } from "@/lib/money";

/** Exported so the approve/reject → header-variant mapping is directly
 * testable without rendering the Radix Dialog portal (which produces
 * empty output under renderToStaticMarkup — see remove-member-dialog.tsx). */
export function decisionHeaderVariant(decision: "approved" | "rejected") {
  return decision === "rejected" ? "destructive" : "warning";
}

export function DecideWithdrawalDialog({
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
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [state, formAction, pending] = useActionState(
    decideWithdrawalRequestAction.bind(null, groupId),
    initialWithdrawalActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Decision recorded</DialogTitle>
              <DialogDescription>{requesterName}&apos;s request has been updated.</DialogDescription>
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
            <input type="hidden" name="decision" value={decision} />
            <DialogHeader variant={decisionHeaderVariant(decision)}>
              <DialogTitle>Decide on {requesterName}&apos;s withdrawal request</DialogTitle>
              <DialogDescription>
                Requested {formatMoney(amountMinorUnits, currencyCode)}. You cannot decide on your own request,
                and if more than one approval is required, this counts as one of them.
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
                <Label htmlFor="withdrawal-decision-select">Decision</Label>
                <Select value={decision} onValueChange={(value) => setDecision(value as typeof decision)}>
                  <SelectTrigger id="withdrawal-decision-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve</SelectItem>
                    <SelectItem value="rejected">Reject</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="withdrawal-decision-notes">{decision === "approved" ? "Note (optional)" : "Reason"}</Label>
                <Textarea
                  id="withdrawal-decision-notes"
                  name="notes"
                  rows={3}
                  required={decision === "rejected"}
                  maxLength={1000}
                />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : decision === "approved" ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
