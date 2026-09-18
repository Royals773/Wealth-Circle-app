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
import { decideLoanApplicationAction } from "@/lib/actions/loans";
import { initialLoanActionState } from "@/lib/actions/action-state";
import { CONTRIBUTION_FREQUENCIES, CONTRIBUTION_FREQUENCY_LABELS } from "@/lib/validations/group";
import { minorToMajorUnits, formatMoney } from "@/lib/money";
import type { ContributionFrequency } from "@/lib/types/database";

/** Exported so the approve/reject → header-variant mapping is directly
 * testable without rendering the Radix Dialog portal (which produces
 * empty output under renderToStaticMarkup — see remove-member-dialog.tsx). */
export function decisionHeaderVariant(decision: "approved" | "rejected") {
  return decision === "rejected" ? "destructive" : "warning";
}

export function LoanDecisionDialog({
  groupId,
  applicationId,
  applicantName,
  requestedAmountMinorUnits,
  requestedTermMonths,
  currencyCode,
  defaultInterestRateBps,
  defaultRepaymentFrequency,
  open,
  onOpenChange,
}: {
  groupId: string;
  applicationId: string;
  applicantName: string;
  requestedAmountMinorUnits: number;
  requestedTermMonths: number;
  currencyCode: string;
  defaultInterestRateBps: number;
  defaultRepaymentFrequency: ContributionFrequency;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [frequency, setFrequency] = useState<ContributionFrequency>(defaultRepaymentFrequency);
  const [state, formAction, pending] = useActionState(
    decideLoanApplicationAction.bind(null, groupId),
    initialLoanActionState,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Decision recorded</DialogTitle>
              <DialogDescription>{applicantName}&apos;s application has been updated.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="decision" value={decision} />
            <DialogHeader variant={decisionHeaderVariant(decision)}>
              <DialogTitle>Decide on {applicantName}&apos;s application</DialogTitle>
              <DialogDescription>
                Requested {formatMoney(requestedAmountMinorUnits, currencyCode)} over {requestedTermMonths} months.
                You cannot decide on your own application.
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
                <Label htmlFor="decision-select">Decision</Label>
                <Select value={decision} onValueChange={(value) => setDecision(value as typeof decision)}>
                  <SelectTrigger id="decision-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve</SelectItem>
                    <SelectItem value="rejected">Reject</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {decision === "approved" ? (
                <div className="space-y-4 rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    Prefilled from the request — adjust if approving different terms. Any difference from
                    what was requested is recorded.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="approved-amount">Approved amount</Label>
                      <Input
                        id="approved-amount"
                        name="approvedAmountMajorUnits"
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        defaultValue={minorToMajorUnits(requestedAmountMinorUnits, currencyCode)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="approved-term">Approved term (months)</Label>
                      <Input
                        id="approved-term"
                        name="approvedTermMonths"
                        type="number"
                        min="1"
                        step="1"
                        required
                        defaultValue={requestedTermMonths}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="approved-rate">Interest rate (%)</Label>
                      <Input
                        id="approved-rate"
                        name="approvedInterestRatePercent"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        defaultValue={defaultInterestRateBps / 100}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="approved-frequency">Repayment frequency</Label>
                      <Select value={frequency} onValueChange={(value) => setFrequency(value as ContributionFrequency)}>
                        <SelectTrigger id="approved-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTRIBUTION_FREQUENCIES.map((option) => (
                            <SelectItem key={option} value={option}>
                              {CONTRIBUTION_FREQUENCY_LABELS[option]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input type="hidden" name="approvedRepaymentFrequency" value={frequency} />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="decision-notes">{decision === "approved" ? "Note (optional)" : "Reason"}</Label>
                <Textarea
                  id="decision-notes"
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
