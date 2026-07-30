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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle, PlusCircle } from "lucide-react";
import { recordRepaymentAction } from "@/lib/actions/loans";
import { initialLoanActionState } from "@/lib/actions/action-state";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";
import { formatMoney } from "@/lib/money";

export interface LoanOption {
  id: string;
  borrowerName: string;
  outstandingPrincipalMinorUnits: number;
  currencyCode: string;
}

export function RecordRepaymentDialog({ groupId, loans }: { groupId: string; loans: LoanOption[] }) {
  const [open, setOpen] = useState(false);
  const [loanId, setLoanId] = useState(loans[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [amount, setAmount] = useState("");
  const [state, formAction, pending] = useActionState(
    recordRepaymentAction.bind(null, groupId),
    initialLoanActionState,
  );

  const selectedLoan = loans.find((l) => l.id === loanId);
  const today = new Date().toISOString().slice(0, 10);
  const amountMinorEquivalent = selectedLoan ? Math.round(Number(amount) * 100) : 0;
  const willOverpay =
    selectedLoan && amount && amountMinorEquivalent > selectedLoan.outstandingPrincipalMinorUnits;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusCircle className="h-4 w-4" /> Record repayment
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Repayment recorded</DialogTitle>
              <DialogDescription>It&apos;s now pending verification.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="loanId" value={loanId} />
            <DialogHeader>
              <DialogTitle>Record a repayment</DialogTitle>
              <DialogDescription>
                Record a payment already received into the group&apos;s bank account against an active loan.
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
                <Label htmlFor="repayment-loan">Loan</Label>
                <Select value={loanId} onValueChange={setLoanId}>
                  <SelectTrigger id="repayment-loan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {loans.map((loan) => (
                      <SelectItem key={loan.id} value={loan.id}>
                        {loan.borrowerName} — outstanding{" "}
                        {formatMoney(loan.outstandingPrincipalMinorUnits, loan.currencyCode)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="repayment-amount">Amount</Label>
                  <Input
                    id="repayment-amount"
                    name="amountMajorUnits"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    aria-invalid={Boolean(state.fieldErrors?.amountMajorUnits)}
                  />
                  {state.fieldErrors?.amountMajorUnits ? (
                    <p className="text-sm text-destructive">{state.fieldErrors.amountMajorUnits}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="repayment-method">Payment method</Label>
                  <Select
                    value={paymentMethod}
                    onValueChange={(value) => setPaymentMethod(value as typeof paymentMethod)}
                  >
                    <SelectTrigger id="repayment-method">
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

              {willOverpay ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    This amount is more than the loan&apos;s outstanding balance — it will be recorded as an
                    overpayment. Double-check the amount before submitting.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="repayment-received-at">Date received</Label>
                <Input
                  id="repayment-received-at"
                  name="receivedAt"
                  type="date"
                  required
                  max={today}
                  defaultValue={today}
                />
                {state.fieldErrors?.receivedAt ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.receivedAt}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="repayment-reference">Bank reference (optional)</Label>
                <Input id="repayment-reference" name="paymentReference" type="text" maxLength={120} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="repayment-notes">Internal note (optional)</Label>
                <Textarea id="repayment-notes" name="notes" rows={2} maxLength={1000} />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="submit" disabled={pending || !loanId}>
                {pending ? "Recording…" : "Record repayment"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
