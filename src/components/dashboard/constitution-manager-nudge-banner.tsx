import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConstitutionManagerNudgeBanner({ groupId }: { groupId: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-foreground">
        <FileSignature className="h-4 w-4 shrink-0" />
        <span>
          You haven&apos;t recorded your own acknowledgement of this group&apos;s constitution yet. As an
          owner or administrator you already have full access — this is just an optional reminder.
        </span>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href={`/dashboard/${groupId}/constitution`}>Review and sign</Link>
      </Button>
    </div>
  );
}
