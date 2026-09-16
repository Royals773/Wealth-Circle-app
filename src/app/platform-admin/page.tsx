import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  isPlatformAdmin,
  loadPendingGroupReviews,
  loadActiveGroupsForModeration,
  loadPendingOrganiserApplications,
  loadActiveOrganisers,
  loadGroupOwnerCounts,
} from "@/lib/data/platform-admin";
import { GroupReviewRow } from "@/components/platform-admin/group-review-row";
import { GroupModerationRow } from "@/components/platform-admin/group-moderation-row";
import { OrganiserApplicationRow } from "@/components/platform-admin/organiser-application-row";
import { OrganiserStatusRow } from "@/components/platform-admin/organiser-status-row";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";

export const metadata: Metadata = { title: "Platform admin" };

// Independently enforced here, in every Server Action the buttons on
// this page call, and inside every RPC those actions invoke — the page
// being absent from nav is not itself a security boundary (see
// docs/security-boundaries.md and 0024_phase10_platform_authorisation.sql).
export default async function PlatformAdminPage() {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/sign-in?next=/platform-admin");
    }
  }

  const admin = await isPlatformAdmin();
  if (!admin) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertDescription>
          You&apos;re not authorised to view this page. Platform administration is restricted to
          a small allowlist of accounts.
        </AlertDescription>
      </Alert>
    );
  }

  const [pendingGroups, moderationGroups, pendingOrganisers, activeOrganisers] = await Promise.all([
    loadPendingGroupReviews(),
    loadActiveGroupsForModeration(),
    loadPendingOrganiserApplications(),
    loadActiveOrganisers(),
  ]);

  const ownerCounts = await loadGroupOwnerCounts(activeOrganisers.map((o) => o.userId));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Platform admin</h1>
        <p className="mt-2 text-muted-foreground">
          Review new groups and organiser applications, and suspend or reactivate either if
          needed. Every decision here is recorded in the audit log.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-foreground">
          Groups awaiting review ({pendingGroups.length})
        </h2>
        <div className="mt-4 space-y-3">
          {pendingGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to review right now.</p>
          ) : (
            pendingGroups.map((g) => (
              <GroupReviewRow
                key={g.id}
                groupId={g.id}
                name={g.name}
                slug={g.slug}
                ownerId={g.ownerId}
                ownerEmail={g.ownerEmail}
                createdAt={g.createdAt}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">
          Organiser applications awaiting review ({pendingOrganisers.length})
        </h2>
        <div className="mt-4 space-y-3">
          {pendingOrganisers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to review right now.</p>
          ) : (
            pendingOrganisers.map((a) => (
              <OrganiserApplicationRow
                key={a.userId}
                userId={a.userId}
                email={a.email}
                fullName={a.fullName}
                applicationNote={a.applicationNote}
                submittedAt={a.submittedAt}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Groups ({moderationGroups.length})</h2>
        <div className="mt-4 space-y-3">
          {moderationGroups.map((g) => (
            <GroupModerationRow key={g.id} groupId={g.id} name={g.name} slug={g.slug} status={g.status} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Organisers ({activeOrganisers.length})</h2>
        <div className="mt-4 space-y-3">
          {activeOrganisers.map((o) => (
            <OrganiserStatusRow
              key={o.userId}
              userId={o.userId}
              email={o.email}
              fullName={o.fullName}
              status={o.status}
              ownedGroupCount={ownerCounts.get(o.userId) ?? 0}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
