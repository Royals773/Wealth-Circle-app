import type { Metadata } from "next";
import { Banknote } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Withdrawals" };

export default function WithdrawalsPage() {
  return (
    <div>
      <PageHeader
        title="Withdrawals"
        description="Requests to withdraw funds from the group's bank account, with two-person approval for sensitive amounts."
      />
      <EmptyState
        icon={Banknote}
        title="No withdrawal requests yet"
        description="When a treasurer or administrator requests a withdrawal, it will appear here awaiting approval."
      />
    </div>
  );
}
