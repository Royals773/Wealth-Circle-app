"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acknowledgeConstitutionAction } from "@/lib/actions/constitution";

export function AcknowledgeConstitutionButton({
  groupId,
  constitutionId,
  label,
}: {
  groupId: string;
  constitutionId: string;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  if (acknowledged) {
    return <Alert>
      <AlertDescription>You&apos;ve acknowledged this version. Thank you.</AlertDescription>
    </Alert>;
  }

  return (
    <div className="space-y-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await acknowledgeConstitutionAction(groupId, constitutionId);
            if (result.error) {
              setError(result.error);
              return;
            }
            setAcknowledged(true);
          });
        }}
      >
        {isPending ? "Submitting…" : (label ?? "I have read and agree to this constitution")}
      </Button>
    </div>
  );
}
