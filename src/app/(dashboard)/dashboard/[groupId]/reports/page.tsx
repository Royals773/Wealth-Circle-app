import type { Metadata } from "next";
import { FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <div>
      <PageHeader
        title="Reports"
        description="Generate summaries of contributions, loans and group finances for a given period."
      />
      <EmptyState
        icon={FileBarChart}
        title="No reports available yet"
        description="Once your group has recorded financial activity, you'll be able to generate reports here."
      />
    </div>
  );
}
