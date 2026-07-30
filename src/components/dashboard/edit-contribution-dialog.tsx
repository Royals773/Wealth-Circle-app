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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { editContributionAction } from "@/lib/actions/contributions";
import { initialContributionActionState } from "@/lib/actions/action-state";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";
import { minorToMajorUnits } from "@/lib/money";
import type { ContributionRecordRow } from "@/components/dashboard/contribution-records-table";

export function EditContributionDialog({
  groupId,
  record,
  open,
  onOpenChange,
}: {
  groupId: string;
  record: ContributionRecordRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>(
    record.paymentMethod ?? "cash",
  );
  const [state, formAction, pending] = useActionState(
    editContributionAction.bind(null, groupId),
    initialContributionActionState,
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Contribution updated</DialogTitle>
              <DialogDescription>The corrected details have been saved.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="recordId" value={record.id} />
            <DialogHeader>
              <DialogTitle>Edit contribution — {record.memberName}</DialogTitle>
              <DialogDescription>
                Only available while this entry is pending verification. Once verified, use Reverse
                instead — a verified record is never edited directly.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {state.formError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{state.formError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-amount">Amount</Label>
                  <Input
                    id="edit-amount"
                    name="amountMajorUnits"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    defaultValue={minorToMajorUnits(record.amountMinorUnits, record.currencyCode)}
                    aria-invalid={Boolean(state.fieldErrors?.amountMajorUnits)}
                  />
                  {state.fieldErrors?.amountMajorUnits ? (
                    <p className="text-sm text-destructive">{state.fieldErrors.amountMajorUnits}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-payment-method">Payment method</Label>
                  <Select
                    value={paymentMethod}
                    onValueChange={(value) => setPaymentMethod(value as typeof paymentMethod)}
                  >
                    <SelectTrigger id="edit-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {PAYMENT_METHOD_LABELS[method]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input type="hidden" name="paymentMethod" value={paymentMethod} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-period-date">Contribution period</Label>
                  <Input
                    id="edit-period-date"
                    name="periodDate"
                    type="date"
                    required
                    defaultValue={record.periodStart ?? today}
                    aria-invalid={Boolean(state.fieldErrors?.periodDate)}
                  />
                  {state.fieldErrors?.periodDate ? (
                    <p className="text-sm text-destructive">{state.fieldErrors.periodDate}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-received-at">Date received</Label>
                  <Input
                    id="edit-received-at"
                    name="receivedAt"
                    type="date"
                    required
                    max={today}
                    defaultValue={record.receivedAt}
                    aria-invalid={Boolean(state.fieldErrors?.receivedAt)}
                  />
                  {state.fieldErrors?.receivedAt ? (
                    <p className="text-sm text-destructive">{state.fieldErrors.receivedAt}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-reference">Bank / payment reference (optional)</Label>
                <Input
                  id="edit-reference"
                  name="paymentReference"
                  type="text"
                  maxLength={120}
                  defaultValue={record.paymentReference ?? ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-notes">Internal note (optional)</Label>
                <Textarea id="edit-notes" name="notes" rows={2} maxLength={1000} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
