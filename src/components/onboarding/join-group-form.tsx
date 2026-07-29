"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { joinGroupAction } from "@/lib/actions/onboarding";
import { initialOnboardingActionState } from "@/lib/actions/action-state";
import { AlertCircle } from "lucide-react";

export function JoinGroupForm() {
  const [state, formAction, pending] = useActionState(
    joinGroupAction,
    initialOnboardingActionState,
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="invitationToken">Invitation link or code</Label>
        <Input
          id="invitationToken"
          name="invitationToken"
          placeholder="Paste the link or code from your invitation email"
          required
          aria-invalid={Boolean(state.fieldErrors?.invitationToken)}
          aria-describedby={
            state.fieldErrors?.invitationToken ? "invitationToken-error" : undefined
          }
        />
        {state.fieldErrors?.invitationToken ? (
          <p id="invitationToken-error" className="text-sm text-destructive">
            {state.fieldErrors.invitationToken}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}
