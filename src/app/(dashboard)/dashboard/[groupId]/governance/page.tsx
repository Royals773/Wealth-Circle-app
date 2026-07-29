import type { Metadata } from "next";
import { Vote } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Governance" };

export default function GovernancePage() {
  return (
    <div>
      <PageHeader
        title="Governance"
        description="Proposals, votes and the group's recorded decisions."
      />
      <EmptyState
        icon={Vote}
        title="No proposals yet"
        description="When a member raises a proposal for the group to vote on, it will appear here along with the outcome."
      />
    </div>
  );
}
