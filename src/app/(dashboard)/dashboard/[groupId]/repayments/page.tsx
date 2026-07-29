import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Repayments" };

export default function RepaymentsPage() {
  return (
    <div>
      <PageHeader
        title="Repayments"
        description="Track loan repayments as they're submitted, verified and reconciled."
      />
      <EmptyState
        icon={ReceiptText}
        title="No repayments recorded yet"
        description="Repayments against active loans will appear here once loans have been disbursed."
      />
    </div>
  );
}
