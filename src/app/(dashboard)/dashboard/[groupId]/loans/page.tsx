import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Loans" };

export default function LoansPage() {
  return (
    <div>
      <PageHeader
        title="Loans"
        description="Review loan applications and track active loans from disbursement to final repayment."
      />
      <EmptyState
        icon={Landmark}
        title="No loans yet"
        description="Loan applications submitted by members will appear here for your loan officers to review."
      />
    </div>
  );
}
