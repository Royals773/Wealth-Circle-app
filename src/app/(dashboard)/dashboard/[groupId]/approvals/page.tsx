import type { Metadata } from "next";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Sensitive actions that require sign-off from a second person before they take effect."
      />
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing awaiting approval"
        description="Withdrawal requests, loan write-offs and other sensitive actions that need a second approver will appear here."
      />
    </div>
  );
}
