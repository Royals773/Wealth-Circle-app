import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ConfirmEmailForm } from "@/components/auth/confirm-email-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getSafeRedirect } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Confirm your email" };

/**
 * Deliberately does NOT verify the token on this GET request — only
 * renders a page with an explicit "Confirm" button that submits to
 * confirmEmailAction. This is what makes the flow resistant to email
 * providers' automatic link-safety prefetching, which would otherwise
 * silently consume the single-use token before the recipient ever
 * clicks it. Configure Supabase's "Confirm signup" and "Reset Password"
 * email templates to link here directly:
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup
 * (or type=recovery) — see docs/architecture.md.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash;
  const type = params.type;
  const isRecovery = type === "recovery";
  const next = getSafeRedirect(params.next, isRecovery ? "/reset-password" : "/onboarding");

  if (!tokenHash || !type) {
    return (
      <AuthShell title="Invalid link" description="This confirmation link is incomplete.">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This link is missing information it needs. Try copying the link from your email
            again, or request a new one.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={isRecovery ? "Reset your password" : "Confirm your email"}
      description={isRecovery ? "One more step before you continue." : "One more step to finish signing up."}
    >
      <ConfirmEmailForm tokenHash={tokenHash} type={type} next={next} isRecovery={isRecovery} />
    </AuthShell>
  );
}
