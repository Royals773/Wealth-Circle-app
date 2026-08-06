import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConstitutionUpdateBanner({ groupId }: { groupId: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-foreground">
        <FileText className="h-4 w-4 shrink-0" />
        <span>A new version of this group&apos;s constitution is available. Re-acknowledging is optional.</span>
      </div>
      <Button asChild size="sm" variant="outline" className="shrink-0">
        <Link href={`/dashboard/${groupId}/constitution`}>Review it</Link>
      </Button>
    </div>
  );
}
