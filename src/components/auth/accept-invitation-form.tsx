"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitationAction, initialAuthActionState } from "@/lib/actions/auth";
import { AlertCircle } from "lucide-react";

export function AcceptInvitationForm({
  token,
  groupName,
  role,
}: {
  token: string;
  groupName: string;
  role: string;
}) {
  const [state, formAction, pending] = useActionState(
    acceptInvitationAction,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />

      <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
        <p className="text-muted-foreground">You&apos;ve been invited to join</p>
        <p className="mt-1 text-base font-semibold text-foreground">{groupName}</p>
        <p className="mt-1 text-muted-foreground">as {role}</p>
      </div>

      {state.formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          aria-invalid={Boolean(state.fieldErrors?.fullName)}
          aria-describedby={state.fieldErrors?.fullName ? "fullName-error" : undefined}
        />
        {state.fieldErrors?.fullName ? (
          <p id="fullName-error" className="text-sm text-destructive">
            {state.fieldErrors.fullName}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Create a password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={state.fieldErrors?.password ? "password-error" : "password-hint"}
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {state.fieldErrors.password}
          </p>
        ) : (
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 10 characters, with an uppercase letter, a lowercase letter and a number.
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining group…" : "Accept invitation and join"}
      </Button>
    </form>
  );
}
