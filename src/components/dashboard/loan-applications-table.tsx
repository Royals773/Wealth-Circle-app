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
import { LoanDecisionDialog } from "@/components/dashboard/loan-decision-dialog";
import { markUnderReviewAction } from "@/lib/actions/loans";
import { formatMoney } from "@/lib/money";
import type { ContributionFrequency, LoanApplicationStatus } from "@/lib/types/database";

export interface LoanApplicationRow {
  id: string;
  applicantName: string;
  amountRequestedMinorUnits: number;
  currencyCode: string;
  termMonths: number;
  purpose: string | null;
  status: LoanApplicationStatus;
  createdAt: string;
}

const STATUS_LABELS: Record<LoanApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function LoanApplicationsTable({
  groupId,
  applications,
  defaultInterestRateBps,
  defaultRepaymentFrequency,
}: {
  groupId: string;
  applications: LoanApplicationRow[];
  defaultInterestRateBps: number;
  defaultRepaymentFrequency: ContributionFrequency;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decisionFor, setDecisionFor] = useState<LoanApplicationRow | null>(null);

  function review(applicationId: string) {
    setError(null);
    setPendingId(applicationId);
    startTransition(async () => {
      const result = await markUnderReviewAction(groupId, applicationId);
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
              <TableHead>Applicant</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Term</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.map((application) => {
              const rowPending = isPending && pendingId === application.id;
              return (
                <TableRow key={application.id}>
                  <TableCell className="font-medium text-foreground">{application.applicantName}</TableCell>
                  <TableCell>{formatMoney(application.amountRequestedMinorUnits, application.currencyCode)}</TableCell>
                  <TableCell className="text-muted-foreground">{application.termMonths} months</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {application.purpose || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{STATUS_LABELS[application.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {application.status === "submitted" ? (
                        <Button size="sm" variant="outline" disabled={rowPending} onClick={() => review(application.id)}>
                          Mark under review
                        </Button>
                      ) : null}
                      {application.status === "submitted" || application.status === "under_review" ? (
                        <Button size="sm" onClick={() => setDecisionFor(application)}>
                          Decide
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
        <LoanDecisionDialog
          groupId={groupId}
          applicationId={decisionFor.id}
          applicantName={decisionFor.applicantName}
          requestedAmountMinorUnits={decisionFor.amountRequestedMinorUnits}
          requestedTermMonths={decisionFor.termMonths}
          currencyCode={decisionFor.currencyCode}
          defaultInterestRateBps={defaultInterestRateBps}
          defaultRepaymentFrequency={defaultRepaymentFrequency}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDecisionFor(null);
          }}
        />
      ) : null}
    </div>
  );
}
