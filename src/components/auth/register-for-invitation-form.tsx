"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { registerForInvitationAction } from "@/lib/actions/auth";
import { initialAuthActionState } from "@/lib/actions/action-state";
import { AlertCircle, MailCheck } from "lucide-react";

export function RegisterForInvitationForm({
  token,
  groupName,
  role,
  email,
}: {
  token: string;
  groupName: string;
  role: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(
    registerForInvitationAction,
    initialAuthActionState,
  );

  const invitationSummary = (
    <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
      <p className="text-muted-foreground">You&apos;ve been invited to join</p>
      <p className="mt-1 text-base font-semibold text-foreground">{groupName}</p>
      <p className="mt-1 text-muted-foreground">as {role}</p>
    </div>
  );

  if (state.status === "success") {
    return (
      <div className="space-y-5">
        {invitationSummary}
        <Alert>
          <MailCheck className="h-4 w-4" />
          <AlertDescription>
            Check your email at {email} for a verification link. Once verified, you&apos;ll be
            brought back here to join {groupName}.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />

      {invitationSummary}

      {state.formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email-display">Email address</Label>
        <Input id="email-display" value={email} disabled />
      </div>

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

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
          aria-describedby={
            state.fieldErrors?.confirmPassword ? "confirmPassword-error" : undefined
          }
        />
        {state.fieldErrors?.confirmPassword ? (
          <p id="confirmPassword-error" className="text-sm text-destructive">
            {state.fieldErrors.confirmPassword}
          </p>
        ) : null}
      </div>

      <div className="flex items-start gap-2">
        <Checkbox id="acceptTerms" name="acceptTerms" required className="mt-0.5" />
        <Label htmlFor="acceptTerms" className="text-sm font-normal text-muted-foreground">
          I understand WealthCircle does not hold or move my group&apos;s money, and I agree
          to keep our group&apos;s money in our own bank account.
        </Label>
      </div>
      {state.fieldErrors?.acceptTerms ? (
        <p className="text-sm text-destructive">{state.fieldErrors.acceptTerms}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account and continue"}
      </Button>
    </form>
  );
}
