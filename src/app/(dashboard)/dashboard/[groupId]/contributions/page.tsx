import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Contributions" };

export default function ContributionsPage() {
  return (
    <div>
      <PageHeader
        title="Contributions"
        description="Track what each member has contributed, verify entries, and reconcile against your bank statement."
      />
      <EmptyState
        icon={HandCoins}
        title="No contributions recorded yet"
        description="Once your treasurer starts recording contributions, they'll appear here with their status — pending, verified, reconciled, or overdue."
      />
    </div>
  );
}
