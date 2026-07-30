"use client";

import { useState } from "react";
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
import { RecordDisbursementDialog } from "@/components/dashboard/record-disbursement-dialog";
import { MarkDefaultedDialog } from "@/components/dashboard/mark-defaulted-dialog";
import { formatMoney } from "@/lib/money";
import type { LoanDisplayStatus } from "@/lib/loans";

export interface LoanRow {
  id: string;
  borrowerName: string;
  principalMinorUnits: number;
  totalRepayableMinorUnits: number;
  currencyCode: string;
  outstandingPrincipalMinorUnits: number;
  displayStatus: LoanDisplayStatus;
}

const STATUS_LABELS: Record<LoanDisplayStatus, string> = {
  awaiting_disbursement: "Awaiting disbursement",
  active: "Active",
  overdue: "Overdue",
  fully_repaid: "Fully repaid",
  defaulted: "Defaulted",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<LoanDisplayStatus, "secondary" | "outline" | "destructive"> = {
  awaiting_disbursement: "outline",
  active: "secondary",
  overdue: "destructive",
  fully_repaid: "secondary",
  defaulted: "destructive",
  cancelled: "outline",
};

export function LoansTable({ groupId, loans }: { groupId: string; loans: LoanRow[] }) {
  const [disbursing, setDisbursing] = useState<LoanRow | null>(null);
  const [defaulting, setDefaulting] = useState<LoanRow | null>(null);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Borrower</TableHead>
              <TableHead>Principal</TableHead>
              <TableHead>Total repayable</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loans.map((loan) => (
              <TableRow key={loan.id}>
                <TableCell className="font-medium text-foreground">{loan.borrowerName}</TableCell>
                <TableCell>{formatMoney(loan.principalMinorUnits, loan.currencyCode)}</TableCell>
                <TableCell>{formatMoney(loan.totalRepayableMinorUnits, loan.currencyCode)}</TableCell>
                <TableCell>{formatMoney(loan.outstandingPrincipalMinorUnits, loan.currencyCode)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[loan.displayStatus]}>{STATUS_LABELS[loan.displayStatus]}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {loan.displayStatus === "awaiting_disbursement" ? (
                      <Button size="sm" onClick={() => setDisbursing(loan)}>
                        Record disbursement
                      </Button>
                    ) : null}
                    {loan.displayStatus === "active" || loan.displayStatus === "overdue" ? (
                      <Button size="sm" variant="ghost" onClick={() => setDefaulting(loan)}>
                        Mark defaulted
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {disbursing ? (
        <RecordDisbursementDialog
          groupId={groupId}
          loanId={disbursing.id}
          borrowerName={disbursing.borrowerName}
          principalMinorUnits={disbursing.principalMinorUnits}
          currencyCode={disbursing.currencyCode}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDisbursing(null);
          }}
        />
      ) : null}

      {defaulting ? (
        <MarkDefaultedDialog
          groupId={groupId}
          loanId={defaulting.id}
          borrowerName={defaulting.borrowerName}
          open={true}
          onOpenChange={(open) => {
            if (!open) setDefaulting(null);
          }}
        />
      ) : null}
    </div>
  );
}
