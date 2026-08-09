import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AlertCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForInvitationForm } from "@/components/auth/register-for-invitation-form";
import { ConfirmJoinGroupForm } from "@/components/auth/confirm-join-group-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import type { GroupRole } from "@/lib/types/database";

export const metadata: Metadata = { title: "Accept invitation" };

interface InvitationPreview {
  groupName: string;
  role: GroupRole;
  email: string;
  canAccept: boolean;
  message: string | null;
}

type InvitationPreviewResult =
  | { status: "not_configured" }
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "found"; data: InvitationPreview };

async function loadInvitationPreview(token: string): Promise<InvitationPreviewResult> {
  if (!isSupabaseConfigured) return { status: "not_configured" };

  // Unauthenticated, token-guessing-adjacent surface — fails CLOSED on
  // unexpected errors (unlike every other rate-limited surface in this
  // app), but still fails open automatically if migration 0017 simply
  // hasn't been deployed yet (PGRST202) — see src/lib/rate-limit.ts.
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const withinLimit = await checkRateLimit({ key: `preview:${ip}`, windowSeconds: 300, max: 20 }, { failClosed: true });
  if (!withinLimit) return { status: "rate_limited" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invitation_preview", { p_token: token });
  const row = data?.[0];

  // group_name/role/email are only ever null when the invitation
  // wasn't found at all — every other unavailable case (revoked,
  // expired, accepted, group suspended/rejected/pending) still returns
  // them alongside can_accept: false, so the page can show a friendly
  // "no longer available" message without ever seeing a raw status.
  if (error || !row || !row.group_name || !row.role || !row.email) return { status: "not_found" };

  return {
    status: "found",
    data: {
      groupName: row.group_name,
      role: row.role,
      email: row.email,
      canAccept: row.can_accept,
      message: row.message,
    },
  };
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await loadInvitationPreview(token);

  if (preview.status === "not_configured") {
    return (
      <AuthShell title="Accept invitation" description="Join a group on WealthCircle.">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Invitations aren&apos;t available in this preview yet — Supabase credentials
            haven&apos;t been configured.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </AuthShell>
    );
  }

  if (preview.status === "rate_limited") {
    return (
      <AuthShell title="Too many attempts" description="Please slow down.">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Too many invitation checks from your network recently. Please try again in a few minutes.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </AuthShell>
    );
  }

  if (preview.status === "not_found") {
    return (
      <AuthShell title="Invitation not found" description="This link may be invalid.">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            We couldn&apos;t find an invitation for this link. Ask the group&apos;s owner or
            administrator to send a new one.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  const invitation = preview.data;

  if (!invitation.canAccept) {
    return (
      <AuthShell title="Invitation no longer available" description="This link can't be used.">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {invitation.message ??
              "This invitation is no longer available. Ask the group's owner or administrator for a new one."}
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </AuthShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const roleLabel = ROLE_LABELS[invitation.role];

  if (!user) {
    return (
      <AuthShell title="You're invited" description="Create your account to join the group.">
        <RegisterForInvitationForm
          token={token}
          groupName={invitation.groupName}
          role={roleLabel}
          email={invitation.email}
        />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/invitations/${token}`)}`}
            className="font-medium text-foreground hover:underline"
          >
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  if (user.email?.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <AuthShell title="Wrong account" description="This invitation is for a different email address.">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You&apos;re signed in as {user.email}, but this invitation was sent to{" "}
            {invitation.email}.
          </AlertDescription>
        </Alert>
        <Button asChild className="mt-6 w-full" variant="outline">
          <Link href={`/sign-in?next=${encodeURIComponent(`/invitations/${token}`)}`}>
            Sign in with a different account
          </Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Join this group?" description="Confirm you'd like to accept this invitation.">
      <ConfirmJoinGroupForm token={token} groupName={invitation.groupName} role={roleLabel} />
    </AuthShell>
  );
}
