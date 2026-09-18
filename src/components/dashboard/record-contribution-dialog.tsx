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
import { AlertCircle, PlusCircle } from "lucide-react";
import { recordContributionAction } from "@/lib/actions/contributions";
import { initialContributionActionState } from "@/lib/actions/action-state";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";

export interface MemberOption {
  id: string;
  fullName: string;
}

export function RecordContributionDialog({
  groupId,
  members,
}: {
  groupId: string;
  members: MemberOption[];
}) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [state, formAction, pending] = useActionState(
    recordContributionAction.bind(null, groupId),
    initialContributionActionState,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusCircle className="h-4 w-4" /> Record contribution
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.status === "success" ? (
          <>
            <DialogHeader variant="success">
              <DialogTitle>Contribution recorded</DialogTitle>
              <DialogDescription>
                It&apos;s now pending verification — you can verify it from the ledger below.
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
            <DialogTitle>Record a contribution</DialogTitle>
            <DialogDescription>
              Record a payment already received into the group&apos;s bank account. This creates a
              pending-verification ledger entry — it doesn&apos;t move any money.
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
              <Label htmlFor="record-member">Member</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger id="record-member">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="memberId" value={memberId} />
              {state.fieldErrors?.memberId ? (
                <p className="text-sm text-destructive">{state.fieldErrors.memberId}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="record-amount">Amount</Label>
                <Input
                  id="record-amount"
                  name="amountMajorUnits"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  aria-invalid={Boolean(state.fieldErrors?.amountMajorUnits)}
                />
                {state.fieldErrors?.amountMajorUnits ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.amountMajorUnits}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="record-payment-method">Payment method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(value) => setPaymentMethod(value as typeof paymentMethod)}
                >
                  <SelectTrigger id="record-payment-method">
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
                <Label htmlFor="record-period-date">Contribution period</Label>
                <Input
                  id="record-period-date"
                  name="periodDate"
                  type="date"
                  required
                  defaultValue={today}
                  aria-invalid={Boolean(state.fieldErrors?.periodDate)}
                />
                <p className="text-xs text-muted-foreground">Any date within the period it covers.</p>
                {state.fieldErrors?.periodDate ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.periodDate}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="record-received-at">Date received</Label>
                <Input
                  id="record-received-at"
                  name="receivedAt"
                  type="date"
                  required
                  max={today}
                  defaultValue={today}
                  aria-invalid={Boolean(state.fieldErrors?.receivedAt)}
                />
                {state.fieldErrors?.receivedAt ? (
                  <p className="text-sm text-destructive">{state.fieldErrors.receivedAt}</p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="record-reference">Bank / payment reference (optional)</Label>
              <Input id="record-reference" name="paymentReference" type="text" maxLength={120} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="record-notes">Internal note (optional)</Label>
              <Textarea id="record-notes" name="notes" rows={2} maxLength={1000} />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={pending || !memberId}>
              {pending ? "Recording…" : "Record contribution"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
