"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cancelWithdrawalRequestAction } from "@/lib/actions/withdrawals";
import { formatMoney } from "@/lib/money";
import { WITHDRAWAL_STATUS_LABELS } from "@/components/dashboard/withdrawal-requests-table";
import type { WithdrawalStatus } from "@/lib/types/database";

export interface MyWithdrawalRequestRow {
  id: string;
  amountMinorUnits: number;
  currencyCode: string;
  reason: string;
  status: WithdrawalStatus;
  createdAt: string;
  paidAmountMinorUnits: number | null;
  paymentDate: string | null;
  paidBankReference: string | null;
}

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

export function MyWithdrawalRequestsTable({ groupId, requests }: { groupId: string; requests: MyWithdrawalRequestRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function cancel(requestId: string) {
    setError(null);
    setPendingId(requestId);
    startTransition(async () => {
      const result = await cancelWithdrawalRequestAction(groupId, requestId);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  return (
    <div>
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
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
              const cancellable = request.status === "submitted" || request.status === "under_review";
              return (
                <TableRow key={request.id}>
                  <TableCell>{formatMoney(request.amountMinorUnits, request.currencyCode)}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">{request.reason}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[request.status]}>{WITHDRAWAL_STATUS_LABELS[request.status]}</Badge>
                    {request.status === "paid_externally" && request.paymentDate ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Paid {new Date(request.paymentDate).toLocaleDateString("en-GB")}
                        {request.paidBankReference ? ` — ref ${request.paidBankReference}` : ""}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(request.createdAt).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell className="text-right">
                    {cancellable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rowPending}
                        onClick={() => cancel(request.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
