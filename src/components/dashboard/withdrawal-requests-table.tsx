"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecideWithdrawalDialog } from "@/components/dashboard/decide-withdrawal-dialog";
import { ConfirmWithdrawalPaymentDialog } from "@/components/dashboard/confirm-withdrawal-payment-dialog";
import { ReverseWithdrawalDialog } from "@/components/dashboard/reverse-withdrawal-dialog";
import { reviewWithdrawalRequestAction } from "@/lib/actions/withdrawals";
import { formatMoney } from "@/lib/money";
import type { WithdrawalStatus } from "@/lib/types/database";

export interface WithdrawalRequestRow {
  id: string;
  requesterName: string;
  amountMinorUnits: number;
  currencyCode: string;
  reason: string;
  status: WithdrawalStatus;
  createdAt: string;
}

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  awaiting_payment: "Awaiting payment",
  paid_externally: "Paid",
  reversed: "Reversed",
};

const STATUS_VARIANT: Record<WithdrawalStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "outline",
  under_review: "secondary",
  approved: "secondary",
  rejected: "destructive",
  cancelled: "outline",
  awaiting_payment: "secondary",
  paid_externally: "default",
  reversed: "destructive",
};

export function WithdrawalRequestsTable({ groupId, requests }: { groupId: string; requests: WithdrawalRequestRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisionFor, setDecisionFor] = useState<WithdrawalRequestRow | null>(null);
  const [paymentFor, setPaymentFor] = useState<WithdrawalRequestRow | null>(null);
  const [reverseFor, setReverseFor] = useState<WithdrawalRequestRow | null>(null);

  function review(requestId: string) {
    setError(null);
    setPendingId(requestId);
    startTransition(async () => {
      const result = await reviewWithdrawalRequestAction(groupId, requestId);
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
              <TableHead>Member</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((request) => {
              const rowPending = isPending && pendingId === request.id;
              return (
                <TableRow key={request.id}>
                  <TableCell className="font-medium text-foreground">{request.requesterName}</TableCell>
                  <TableCell>{formatMoney(request.amountMinorUnits, request.currencyCode)}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">{request.reason}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[request.status]}>{WITHDRAWAL_STATUS_LABELS[request.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(request.createdAt).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {request.status === "submitted" ? (
                        <Button size="sm" variant="outline" disabled={rowPending} onClick={() => review(request.id)}>
                          Mark under review
                        </Button>
                      ) : null}
                      {request.status === "submitted" || request.status === "under_review" ? (
                        <Button size="sm" onClick={() => setDecisionFor(request)}>
                          Decide
                        </Button>
                      ) : null}
                      {request.status === "awaiting_payment" ? (
                        <Button size="sm" onClick={() => setPaymentFor(request)}>
                          Confirm payment
                        </Button>
                      ) : null}
                      {request.status === "paid_externally" ? (
                        <Button size="sm" variant="outline" onClick={() => setReverseFor(request)}>
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

      {decisionFor ? (
        <DecideWithdrawalDialog
          groupId={groupId}
          requestId={decisionFor.id}
          requesterName={decisionFor.requesterName}
          amountMinorUnits={decisionFor.amountMinorUnits}
          currencyCode={decisionFor.currencyCode}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDecisionFor(null);
          }}
        />
      ) : null}

      {paymentFor ? (
        <ConfirmWithdrawalPaymentDialog
          groupId={groupId}
          requestId={paymentFor.id}
          requesterName={paymentFor.requesterName}
          amountMinorUnits={paymentFor.amountMinorUnits}
          currencyCode={paymentFor.currencyCode}
          open={true}
          onOpenChange={(open) => {
            if (!open) setPaymentFor(null);
          }}
        />
      ) : null}

      {reverseFor ? (
        <ReverseWithdrawalDialog
          groupId={groupId}
          requestId={reverseFor.id}
          requesterName={reverseFor.requesterName}
          amountMinorUnits={reverseFor.amountMinorUnits}
          currencyCode={reverseFor.currencyCode}
          open={true}
          onOpenChange={(open) => {
            if (!open) setReverseFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
