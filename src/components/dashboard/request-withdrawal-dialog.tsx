"use client";

import { useActionState, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Banknote } from "lucide-react";
import { requestWithdrawalAction } from "@/lib/actions/withdrawals";
import { initialWithdrawalActionState } from "@/lib/actions/action-state";
import { minorToMajorUnits, formatMoney } from "@/lib/money";
import type { WithdrawalEligibilityResult } from "@/lib/withdrawals";

export function RequestWithdrawalDialog({
  groupId,
  currencyCode,
  eligibility,
  reservedAmount,
  noticePeriodDays,
  requiredApprovals,
}: {
  groupId: string;
  currencyCode: string;
  eligibility: WithdrawalEligibilityResult;
  reservedAmount: number;
  noticePeriodDays: number;
  requiredApprovals: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction, pending] = useActionState(
    requestWithdrawalAction.bind(null, groupId),
    initialWithdrawalActionState,
  );

  if (!eligibility.eligible) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{eligibility.reasons.join(" ")}</AlertDescription>
      </Alert>
    );
  }

  const maxAvailableMajor = minorToMajorUnits(eligibility.availableToWithdraw, currencyCode);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Banknote className="h-4 w-4" /> Request a withdrawal
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Request submitted</DialogTitle>
              <DialogDescription>
                Your request is now awaiting review — you can track its status on this page.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <DialogHeader>
              <DialogTitle>Request a withdrawal</DialogTitle>
              <DialogDescription>
                You can currently withdraw up to {formatMoney(eligibility.availableToWithdraw, currencyCode)}.
                {reservedAmount > 0
                  ? ` ${formatMoney(reservedAmount, currencyCode)} is already reserved by an open request.`
                  : ""}
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
                <Label htmlFor="withdraw-amount">Amount requested</Label>
                <Input
                  id="withdraw-amount"
                  name="amountMajorUnits"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={maxAvailableMajor}
                  required
                  aria-invalid={Boolean(state.fieldErrors?.amountMajorUnits)}
                />
                {state.fieldErrors?.amountMajorUnits ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.amountMajorUnits}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="withdraw-reason">Reason</Label>
                <Textarea id="withdraw-reason" name="reason" rows={2} maxLength={500} required />
                {state.fieldErrors?.reason ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.reason}</p>
                ) : null}
              </div>

              <div className="space-y-1 rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                <p>This group requires {requiredApprovals} approval(s) before payment.</p>
                {noticePeriodDays > 0 ? (
                  <p>Payment can&apos;t be confirmed until {noticePeriodDays} day(s) after submission.</p>
                ) : null}
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="withdraw-confirm"
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                <Label htmlFor="withdraw-confirm" className="font-normal">
                  I understand WealthCircle records this request but does not hold or transfer money —
                  any approved withdrawal is paid manually from the group&apos;s own bank account.
                </Label>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending || !confirmed}>
                {pending ? "Submitting…" : "Submit request"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
