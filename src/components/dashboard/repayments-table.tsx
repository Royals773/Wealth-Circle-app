"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RepaymentReasonDialog } from "@/components/dashboard/repayment-reason-dialog";
import { verifyRepaymentAction, reconcileRepaymentAction } from "@/lib/actions/loans";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";
import type { PaymentMethod, RepaymentStatus } from "@/lib/types/database";

export interface RepaymentRow {
  id: string;
  borrowerName: string;
  amountMinorUnits: number;
  principalPortionMinorUnits: number;
  interestPortionMinorUnits: number;
  currencyCode: string;
  receivedAt: string;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  status: RepaymentStatus;
}

const STATUS_LABELS: Record<RepaymentStatus, string> = {
  pending_verification: "Pending verification",
  verified: "Verified",
  reconciled: "Reconciled",
  rejected: "Rejected",
  reversed: "Reversed",
};

const STATUS_VARIANT: Record<RepaymentStatus, "secondary" | "outline" | "destructive"> = {
  pending_verification: "outline",
  verified: "secondary",
  reconciled: "secondary",
  rejected: "destructive",
  reversed: "destructive",
};

export function RepaymentsTable({ groupId, repayments }: { groupId: string; repayments: RepaymentRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "reject" | "reverse"; repaymentId: string } | null>(null);

  function verify(repaymentId: string) {
    setError(null);
    setPendingId(repaymentId);
    startTransition(async () => {
      const result = await verifyRepaymentAction(groupId, repaymentId);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  function reconcile(repaymentId: string) {
    setError(null);
    setPendingId(repaymentId);
    startTransition(async () => {
      const result = await reconcileRepaymentAction(groupId, repaymentId);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  return (
    <div>
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Borrower</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Principal / interest</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {repayments.map((repayment) => {
              const rowPending = isPending && pendingId === repayment.id;
              return (
                <TableRow key={repayment.id}>
                  <TableCell className="font-medium text-foreground">{repayment.borrowerName}</TableCell>
                  <TableCell>{formatMoney(repayment.amountMinorUnits, repayment.currencyCode)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatMoney(repayment.principalPortionMinorUnits, repayment.currencyCode)} /{" "}
                    {formatMoney(repayment.interestPortionMinorUnits, repayment.currencyCode)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(repayment.receivedAt).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {repayment.paymentMethod ? PAYMENT_METHOD_LABELS[repayment.paymentMethod] : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[repayment.status]}>{STATUS_LABELS[repayment.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {repayment.status === "pending_verification" ? (
                        <>
                          <Button size="sm" variant="outline" disabled={rowPending} onClick={() => verify(repayment.id)}>
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rowPending}
                            onClick={() => setDialog({ mode: "reject", repaymentId: repayment.id })}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      {repayment.status === "verified" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rowPending}
                            onClick={() => reconcile(repayment.id)}
                          >
                            Reconcile
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rowPending}
                            onClick={() => setDialog({ mode: "reverse", repaymentId: repayment.id })}
                          >
                            Reverse
                          </Button>
                        </>
                      ) : null}
                      {repayment.status === "reconciled" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={rowPending}
                          onClick={() => setDialog({ mode: "reverse", repaymentId: repayment.id })}
                        >
                          Reverse
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {dialog ? (
        <RepaymentReasonDialog
          mode={dialog.mode}
          groupId={groupId}
          repaymentId={dialog.repaymentId}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
