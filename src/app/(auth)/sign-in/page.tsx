import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getSafeRedirect } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

const LINK_ERROR_MESSAGES: Record<string, string> = {
  invalid_link: "That link is invalid. Please sign in, or request a new one.",
  expired_link: "That link has expired. Please sign in, or request a new one.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = getSafeRedirect(params.next, "");
  const linkError = params.error ? LINK_ERROR_MESSAGES[params.error] : undefined;

  return (
    <AuthShell title="Welcome back" description="Sign in to access your groups.">
      <SignInForm next={next} linkError={linkError} />
    </AuthShell>
  );
}
