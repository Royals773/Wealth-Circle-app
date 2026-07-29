"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resetPasswordAction, initialAuthActionState } from "@/lib/actions/auth";
import { AlertCircle } from "lucide-react";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    initialAuthActionState,
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
        <Label htmlFor="password">New password</Label>
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
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
          aria-describedby={state.fieldErrors?.confirmPassword ? "confirmPassword-error" : undefined}
        />
        {state.fieldErrors?.confirmPassword ? (
          <p id="confirmPassword-error" className="text-sm text-destructive">
            {state.fieldErrors.confirmPassword}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Resetting password…" : "Reset password"}
      </Button>
    </form>
  );
}
