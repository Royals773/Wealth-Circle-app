import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import type { MemberPeriodStatusRow } from "@/lib/data/contribution-summary";
import type { MemberPeriodStatus } from "@/lib/contributions";

const STATUS_LABELS: Record<MemberPeriodStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  unpaid: "Unpaid",
  overdue: "Overdue",
  not_applicable: "Not applicable",
};

const STATUS_VARIANT: Record<MemberPeriodStatus, "secondary" | "outline" | "destructive"> = {
  paid: "secondary",
  partial: "outline",
  unpaid: "outline",
  overdue: "destructive",
  not_applicable: "outline",
};

export function MonthlyContributionStatusTable({
  rows,
  currencyCode,
}: {
  rows: MemberPeriodStatusRow[];
  currencyCode: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead>Verified</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const percent =
              row.requiredAmount && row.requiredAmount > 0
                ? Math.min(100, Math.round((row.verifiedTotal / row.requiredAmount) * 100))
                : row.verifiedTotal > 0
                  ? 100
                  : 0;
            return (
              <TableRow key={row.memberId}>
                <TableCell className="font-medium text-foreground">{row.memberName}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.requiredAmount !== null ? formatMoney(row.requiredAmount, currencyCode) : "Flexible"}
                </TableCell>
                <TableCell>{formatMoney(row.verifiedTotal, currencyCode)}</TableCell>
                <TableCell className="min-w-[120px]">
                  {row.status === "not_applicable" ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <Progress value={percent} aria-label={`${percent}% of expected contribution verified`} />
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
