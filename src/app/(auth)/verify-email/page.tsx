import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Check your email" description="We've sent you a verification link.">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
          <MailCheck aria-hidden className="h-6 w-6 text-accent-foreground" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Click the link in the email we sent you to verify your address. Once verified, you
          can sign in and create or join a group.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
