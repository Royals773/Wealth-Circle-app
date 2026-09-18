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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { rejectRepaymentAction, reverseRepaymentAction } from "@/lib/actions/loans";
import { initialLoanActionState } from "@/lib/actions/action-state";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";

type Mode = "reject" | "reverse";

const COPY: Record<Mode, { title: string; description: string; confirmLabel: string }> = {
  reject: {
    title: "Reject this repayment",
    description:
      "Use this when a pending entry was recorded in error or the payment was never actually received. This can't be undone once rejected.",
    confirmLabel: "Reject",
  },
  reverse: {
    title: "Reverse this repayment",
    description:
      "The original record is kept, marked reversed, and stays visible for audit — it's never edited or deleted. If the payment should be recorded correctly, you can create a replacement entry below.",
    confirmLabel: "Reverse",
  },
};

export function RepaymentReasonDialog({
  mode,
  groupId,
  repaymentId,
  open,
  onOpenChange,
}: {
  mode: Mode;
  groupId: string;
  repaymentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const action = mode === "reject" ? rejectRepaymentAction : reverseRepaymentAction;
  const [state, formAction, pending] = useActionState(
    action.bind(null, groupId),
    initialLoanActionState,
  );
  const [createReplacement, setCreateReplacement] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const copy = COPY[mode];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>Done — the record has been updated.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
        <form action={formAction}>
          <input type="hidden" name="repaymentId" value={repaymentId} />
          <DialogHeader variant="destructive">
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {state.formError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{state.formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="repayment-reason">Reason</Label>
              <Textarea id="repayment-reason" name="reason" rows={3} required maxLength={1000} />
              {state.fieldErrors?.reason ? (
                <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
              ) : null}
            </div>

            {mode === "reverse" ? (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="repayment-create-replacement"
                    checked={createReplacement}
                    onCheckedChange={(checked) => setCreateReplacement(checked === true)}
                  />
                  <Label htmlFor="repayment-create-replacement" className="font-normal">
                    Create a corrected replacement entry
                  </Label>
                </div>
                <input type="hidden" name="createReplacement" value={String(createReplacement)} />

                {createReplacement ? (
                  <div className="space-y-4 rounded-md border border-border p-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="repayment-rev-amount">Correct amount</Label>
                        <Input id="repayment-rev-amount" name="amountMajorUnits" type="number" min="0.01" step="0.01" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="repayment-rev-method">Payment method</Label>
                        <Select
                          value={paymentMethod}
                          onValueChange={(value) => setPaymentMethod(value as typeof paymentMethod)}
                        >
                          <SelectTrigger id="repayment-rev-method">
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
                    <div className="space-y-2">
                      <Label htmlFor="repayment-rev-received">Correct date received</Label>
                      <Input id="repayment-rev-received" name="receivedAt" type="date" max={today} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="repayment-rev-reference">Bank reference</Label>
                      <Input id="repayment-rev-reference" name="paymentReference" type="text" maxLength={120} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave a field blank to keep the original record&apos;s value.
                    </p>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Saving…" : copy.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
