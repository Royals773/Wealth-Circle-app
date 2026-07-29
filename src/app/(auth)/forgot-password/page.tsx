import type { Metadata } from "next";
import { AlertCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email address on your account and we'll send a reset link."
    >
      {error === "expired_link" ? (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            That reset link has expired. Enter your email below to request a new one.
          </AlertDescription>
        </Alert>
      ) : null}
      <ForgotPasswordForm />
    </AuthShell>
  );
}
