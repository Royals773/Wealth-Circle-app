import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AcceptInvitationForm } from "@/components/auth/accept-invitation-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { GroupRole } from "@/lib/types/database";

export const metadata: Metadata = { title: "Accept invitation" };

async function loadInvitation(token: string) {
  if (!isSupabaseConfigured) return { status: "not_configured" as const };

  const supabase = await createClient();
  const { data: invitation, error } = await supabase
    .from("group_invitations")
    .select("group_id, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !invitation) return { status: "not_found" as const };
  if (invitation.status !== "pending") return { status: "not_found" as const };
  if (new Date(invitation.expires_at) < new Date()) return { status: "expired" as const };

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", invitation.group_id)
    .maybeSingle();

  return {
    status: "found" as const,
    role: invitation.role as GroupRole,
    groupName: group?.name ?? "this group",
  };
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await loadInvitation(token);

  if (invitation.status === "not_configured") {
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

  if (invitation.status === "not_found" || invitation.status === "expired") {
    return (
      <AuthShell title="Invitation not found" description="This link may be invalid or expired.">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {invitation.status === "expired"
              ? "This invitation has expired. Ask the group's owner or administrator to send a new one."
              : "We couldn't find an invitation for this link. It may have already been used or revoked."}
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
      title="You're invited"
      description="Create your account to join the group."
    >
      <AcceptInvitationForm
        token={token}
        groupName={invitation.groupName}
        role={ROLE_LABELS[invitation.role]}
      />
    </AuthShell>
  );
}
