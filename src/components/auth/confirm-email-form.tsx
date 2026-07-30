"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { confirmEmailAction } from "@/lib/actions/auth";
import { initialAuthActionState } from "@/lib/actions/action-state";
import { AlertCircle, ShieldCheck } from "lucide-react";

export function ConfirmEmailForm({
  tokenHash,
  type,
  next,
  isRecovery,
}: {
  tokenHash: string;
  type: string;
  next: string;
  isRecovery: boolean;
}) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, initialAuthActionState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="tokenHash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
          <ShieldCheck aria-hidden className="h-6 w-6 text-accent-foreground" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {isRecovery
            ? "Click below to confirm it's really you before setting a new password."
            : "Click below to confirm your email address and finish creating your account."}
        </p>
      </div>

      {state.formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Confirming…" : isRecovery ? "Confirm and continue" : "Confirm email address"}
      </Button>
    </form>
  );
}
