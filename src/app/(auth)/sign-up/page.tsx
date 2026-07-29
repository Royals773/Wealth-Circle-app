import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Set up your personal account, then create or join a group."
      footer={
        <p>
          By creating an account you agree that WealthCircle records your group&apos;s
          activity but never holds or moves your money. Read more on our{" "}
          <Link href="/#security" className="underline hover:text-foreground">
            security page
          </Link>
          .
        </p>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
