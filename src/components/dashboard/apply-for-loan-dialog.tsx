"use client";

import { useActionState, useMemo, useState } from "react";
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
import { AlertCircle, HandCoins } from "lucide-react";
import { applyForLoanAction } from "@/lib/actions/loans";
import { initialLoanActionState } from "@/lib/actions/action-state";
import { computeOneTimeFlatInterest, computeLoanRepaymentSchedule } from "@/lib/loans";
import { majorToMinorUnits, minorToMajorUnits, formatMoney } from "@/lib/money";
import { LENDING_DISABLED } from "@/lib/lending-gate";
import { LendingDisabledNotice } from "@/components/dashboard/lending-disabled-notice";
import type { EligibilityResult } from "@/lib/loan-eligibility";
import type { ContributionFrequency } from "@/lib/types/database";

export function ApplyForLoanDialog({
  groupId,
  currencyCode,
  eligibility,
  verifiedContributionsTotal,
  interestRateBps,
  repaymentFrequency,
  minTermMonths,
  maxTermMonths,
}: {
  groupId: string;
  currencyCode: string;
  eligibility: EligibilityResult;
  verifiedContributionsTotal: number;
  interestRateBps: number;
  repaymentFrequency: ContributionFrequency;
  minTermMonths: number | null;
  maxTermMonths: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [amountMajor, setAmountMajor] = useState("");
  const [termMonths, setTermMonths] = useState(String(minTermMonths ?? 1));
  const [confirmed, setConfirmed] = useState(false);
  const [state, formAction, pending] = useActionState(
    applyForLoanAction.bind(null, groupId),
    initialLoanActionState,
  );

  const preview = useMemo(() => {
    const amountMajorNumber = Number(amountMajor);
    const term = Number(termMonths);
    if (!amountMajorNumber || amountMajorNumber <= 0 || !term || term <= 0) return null;

    const principalMinorUnits = majorToMinorUnits(amountMajorNumber, currencyCode);
    const interestMinorUnits = computeOneTimeFlatInterest(principalMinorUnits, interestRateBps);
    const totalRepayableMinorUnits = principalMinorUnits + interestMinorUnits;
    const schedule = computeLoanRepaymentSchedule({
      disbursementDate: new Date().toISOString().slice(0, 10),
      termMonths: term,
      frequency: repaymentFrequency,
      totalRepayableMinorUnits,
    });

    return { interestMinorUnits, totalRepayableMinorUnits, instalments: schedule.length };
  }, [amountMajor, termMonths, currencyCode, interestRateBps, repaymentFrequency]);

  const maxAvailableMajor = minorToMajorUnits(eligibility.availableToBorrow, currencyCode);

  if (LENDING_DISABLED) {
    return <LendingDisabledNotice />;
  }

  if (!eligibility.eligible) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{eligibility.reasons.join(" ")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <HandCoins className="h-4 w-4" /> Apply for a loan
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Application submitted</DialogTitle>
              <DialogDescription>
                Your loan officer will review it — you can track its status on this page.
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
            <DialogHeader variant="default">
              <DialogTitle>Apply for a loan</DialogTitle>
              <DialogDescription>
                Your verified contribution balance is {formatMoney(verifiedContributionsTotal, currencyCode)}.
                Based on this group&apos;s policy, you can currently borrow up to{" "}
                {formatMoney(eligibility.availableToBorrow, currencyCode)}.
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
                <Label htmlFor="apply-amount">Amount requested</Label>
                <Input
                  id="apply-amount"
                  name="amountMajorUnits"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={maxAvailableMajor}
                  required
                  value={amountMajor}
                  onChange={(event) => setAmountMajor(event.target.value)}
                  aria-invalid={Boolean(state.fieldErrors?.amountMajorUnits)}
                />
                {state.fieldErrors?.amountMajorUnits ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.amountMajorUnits}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="apply-term">Repayment term (months)</Label>
                <Input
                  id="apply-term"
                  name="termMonths"
                  type="number"
                  min={minTermMonths ?? 1}
                  max={maxTermMonths ?? undefined}
                  step="1"
                  required
                  value={termMonths}
                  onChange={(event) => setTermMonths(event.target.value)}
                />
                {state.fieldErrors?.termMonths ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.termMonths}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="apply-purpose">Purpose (optional)</Label>
                <Textarea id="apply-purpose" name="purpose" rows={2} maxLength={500} />
              </div>

              {preview ? (
                <div className="space-y-1 rounded-md border border-border bg-secondary/40 p-3 text-sm">
                  <p>
                    Interest ({(interestRateBps / 100).toFixed(2)}% one-time flat):{" "}
                    <span className="font-medium text-foreground">
                      {formatMoney(preview.interestMinorUnits, currencyCode)}
                    </span>
                  </p>
                  <p>
                    Total repayable:{" "}
                    <span className="font-medium text-foreground">
                      {formatMoney(preview.totalRepayableMinorUnits, currencyCode)}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Approximately {preview.instalments} instalments, paid {repaymentFrequency}.
                  </p>
                </div>
              ) : null}

              <div className="flex items-start gap-2">
                <Checkbox
                  id="apply-confirm"
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                <Label htmlFor="apply-confirm" className="font-normal">
                  I confirm the details above are accurate and understand this creates a real loan
                  application for review — WealthCircle does not disburse funds itself; any approved
                  loan is transferred manually from the group&apos;s own bank account.
                </Label>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending || !confirmed}>
                {pending ? "Submitting…" : "Submit application"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
