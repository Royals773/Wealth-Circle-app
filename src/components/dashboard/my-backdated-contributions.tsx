"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmBackdatedContributionAction } from "@/lib/actions/backdated-contributions";
import { formatMoney } from "@/lib/money";
import type { BackdatedContributionRow } from "@/lib/data/backdated-contributions";

export function MyBackdatedContributions({
  groupId,
  records,
}: {
  groupId: string;
  records: BackdatedContributionRow[];
}) {
  if (records.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="mb-1 text-sm font-semibold text-foreground">Back-dated / imported history</h2>
      <p className="mb-1 text-xs text-muted-foreground">
        These entries were added on your behalf, dated for when the contribution actually happened rather than
        when they were entered — clearly labelled as such, never mixed in silently with contemporaneous records.
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Like the rest of this group&apos;s contribution ledger, these entries are visible to every member of the
        group, not just you.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date it happened</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Entered</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Your confirmation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <BackdatedRow key={record.id} groupId={groupId} record={record} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BackdatedRow({ groupId, record }: { groupId: string; record: BackdatedContributionRow }) {
  const [confirmedAt, setConfirmedAt] = useState(record.confirmedAt);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <TableRow>
      <TableCell>
        {new Date(record.receivedAt).toLocaleDateString("en-GB")}
        <Badge variant="secondary" className="ml-2">
          Back-dated
        </Badge>
      </TableCell>
      <TableCell>{formatMoney(record.amountMinorUnits, record.currencyCode)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(record.createdAt).toLocaleDateString("en-GB")} by {record.createdByName}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{record.note || "—"}</TableCell>
      <TableCell>
        {confirmedAt ? (
          <span className="text-xs text-muted-foreground">
            Confirmed {new Date(confirmedAt).toLocaleDateString("en-GB")}
          </span>
        ) : (
          <div className="space-y-1">
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await confirmBackdatedContributionAction(groupId, record.id);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setConfirmedAt(new Date().toISOString());
                });
              }}
            >
              {isPending ? "Confirming…" : "Looks correct"}
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
