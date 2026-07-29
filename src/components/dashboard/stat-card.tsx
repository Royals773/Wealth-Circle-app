import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 pt-6">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
          <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
