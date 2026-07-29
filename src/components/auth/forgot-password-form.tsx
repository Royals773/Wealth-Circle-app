"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { forgotPasswordAction, initialAuthActionState } from "@/lib/actions/auth";
import { AlertCircle, MailCheck } from "lucide-react";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    initialAuthActionState,
  );

  if (state.status === "success") {
    return (
      <Alert>
        <MailCheck className="h-4 w-4" />
        <AlertDescription>
          If an account exists for that email address, we&apos;ve sent a link to reset the
          password. Check your inbox.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.formError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="text-sm text-destructive">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending link…" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Remembered your password?{" "}
        <Link href="/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
