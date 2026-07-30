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
import { ContributionReasonDialog } from "@/components/dashboard/contribution-reason-dialog";
import { EditContributionDialog } from "@/components/dashboard/edit-contribution-dialog";
import { verifyContributionAction, reconcileContributionAction } from "@/lib/actions/contributions";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/validations/contributions";
import type { ContributionRecordStatus, PaymentMethod } from "@/lib/types/database";

export interface ContributionRecordRow {
  id: string;
  memberName: string;
  amountMinorUnits: number;
  currencyCode: string;
  periodStart: string | null;
  periodEnd: string | null;
  receivedAt: string;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  status: ContributionRecordStatus;
}

const STATUS_LABELS: Record<ContributionRecordStatus, string> = {
  pending_verification: "Pending verification",
  verified: "Verified",
  reconciled: "Reconciled",
  rejected: "Rejected",
  reversed: "Reversed",
};

const STATUS_VARIANT: Record<ContributionRecordStatus, "secondary" | "outline" | "destructive"> = {
  pending_verification: "outline",
  verified: "secondary",
  reconciled: "secondary",
  rejected: "destructive",
  reversed: "destructive",
};

export function ContributionRecordsTable({
  groupId,
  records,
}: {
  groupId: string;
  records: ContributionRecordRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "reject" | "reverse"; recordId: string } | null>(null);
  const [editingRecord, setEditingRecord] = useState<ContributionRecordRow | null>(null);

  function verify(recordId: string) {
    setError(null);
    setPendingId(recordId);
    startTransition(async () => {
      const result = await verifyContributionAction(groupId, recordId);
      if (result.error) setError(result.error);
      setPendingId(null);
    });
  }

  function reconcile(recordId: string) {
    setError(null);
    setPendingId(recordId);
    startTransition(async () => {
      const result = await reconcileContributionAction(groupId, recordId);
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
              <TableHead>Period</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => {
              const rowPending = isPending && pendingId === record.id;
              return (
                <TableRow key={record.id}>
                  <TableCell className="font-medium text-foreground">{record.memberName}</TableCell>
                  <TableCell>{formatMoney(record.amountMinorUnits, record.currencyCode)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.periodStart
                      ? `${new Date(record.periodStart).toLocaleDateString("en-GB")} – ${
                          record.periodEnd ? new Date(record.periodEnd).toLocaleDateString("en-GB") : ""
                        }`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(record.receivedAt).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.paymentMethod ? PAYMENT_METHOD_LABELS[record.paymentMethod] : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[record.status]}>{STATUS_LABELS[record.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {record.status === "pending_verification" ? (
                        <>
                          <Button size="sm" variant="outline" disabled={rowPending} onClick={() => verify(record.id)}>
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rowPending}
                            onClick={() => setEditingRecord(record)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rowPending}
                            onClick={() => setDialog({ mode: "reject", recordId: record.id })}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                      {record.status === "verified" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rowPending}
                            onClick={() => reconcile(record.id)}
                          >
                            Reconcile
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rowPending}
                            onClick={() => setDialog({ mode: "reverse", recordId: record.id })}
                          >
                            Reverse
                          </Button>
                        </>
                      ) : null}
                      {record.status === "reconciled" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={rowPending}
                          onClick={() => setDialog({ mode: "reverse", recordId: record.id })}
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
        <ContributionReasonDialog
          mode={dialog.mode}
          groupId={groupId}
          recordId={dialog.recordId}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}

      {editingRecord ? (
        <EditContributionDialog
          groupId={groupId}
          record={editingRecord}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditingRecord(null);
          }}
        />
      ) : null}
    </div>
  );
}
