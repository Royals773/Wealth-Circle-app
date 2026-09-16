import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { LENDING_DISABLED_MESSAGE } from "@/lib/lending-gate";

export function LendingDisabledNotice({ message }: { message?: string } = {}) {
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription>{message ?? LENDING_DISABLED_MESSAGE}</AlertDescription>
    </Alert>
  );
}
