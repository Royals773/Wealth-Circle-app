import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { LENDING_DISABLED_MESSAGE } from "@/lib/lending-gate";

export function LendingDisabledNotice() {
  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription>{LENDING_DISABLED_MESSAGE}</AlertDescription>
    </Alert>
  );
}
