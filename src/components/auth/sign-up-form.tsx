"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { signUpAction, initialAuthActionState } from "@/lib/actions/auth";
import { AlertCircle } from "lucide-react";

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initialAuthActionState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
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

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
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
          aria-describedby={state.fieldErrors?.confirmPassword ? "confirmPassword-error" : undefined}
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
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
