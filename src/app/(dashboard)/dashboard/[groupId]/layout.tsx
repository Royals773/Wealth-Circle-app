import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ConstitutionUpdateBanner } from "@/components/dashboard/constitution-update-banner";
import { ConstitutionManagerNudgeBanner } from "@/components/dashboard/constitution-manager-nudge-banner";
import { AcknowledgeConstitutionButton } from "@/components/dashboard/acknowledge-constitution-button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDashboardContext } from "@/lib/data/dashboard";
import { loadUnreadNotificationCount } from "@/lib/data/notification-summary";
import { loadConstitutionGateStatus, getConstitutionDownloadUrl } from "@/lib/data/constitution";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export default async function GroupDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const [context, unreadNotificationCount] = await Promise.all([
    getDashboardContext(groupId),
    loadUnreadNotificationCount(),
  ]);

  let gate: Awaited<ReturnType<typeof loadConstitutionGateStatus>> | null = null;
  let downloadUrl: string | null = null;
  let userId: string | null = null;
  let isManager = false;

  if (context.configured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      const [gateResult, currentRole] = await Promise.all([
        loadConstitutionGateStatus(groupId, user.id),
        getCurrentMembershipRole(groupId),
      ]);
      gate = gateResult;
      isManager = currentRole !== null && roleHasCapability(currentRole, "manage_constitution");
      if (gate.hasConstitution && !gate.hasAcknowledgedAny && gate.current) {
        downloadUrl = await getConstitutionDownloadUrl(gate.current.storagePath);
      }
    }
  }

  // Owners/administrators are exempt: publishing a constitution must never
  // lock the publisher out of the group they just published it to.
  const isBlocked =
    !!gate?.hasConstitution && !gate?.hasAcknowledgedAny && !!gate?.current && !!userId && !isManager;

  // Managers are never blocked, but a manager who's never personally signed
  // gets no prompt at all otherwise — this nudge closes that gap without
  // gating access. Mutually exclusive with the update banner below: that one
  // only fires once hasAcknowledgedAny is true, this one only while it's false.
  const showManagerNudge =
    isManager && !!gate?.hasConstitution && !gate?.hasAcknowledgedAny && !!gate?.current && !!userId;

  return (
    <DashboardShell
      groupId={context.groupId}
      currentGroup={context.currentGroup}
      memberships={context.memberships}
      unreadNotificationCount={unreadNotificationCount}
    >
      {!context.configured ? (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          Supabase isn&apos;t configured yet, so this is a structural preview — every page
          below shows its real empty state with no live data.
        </div>
      ) : null}

      {isBlocked && gate?.current ? (
        <div className="mx-auto max-w-xl py-10">
          <Card className="border-warning/40 bg-warning/10">
            <CardHeader>
              <CardTitle>Please review and sign your group&apos;s constitution</CardTitle>
              <CardDescription>
                Before you can access the rest of this group, please review and acknowledge{" "}
                {gate.current.title} (version {gate.current.version}).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {downloadUrl ? (
                <Button asChild variant="outline" size="sm">
                  <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                    Download PDF to review
                  </a>
                </Button>
              ) : null}
              <AcknowledgeConstitutionButton groupId={groupId} constitutionId={gate.current.id} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {gate?.hasNewerVersionThanAcknowledged ? <ConstitutionUpdateBanner groupId={groupId} /> : null}
          {showManagerNudge ? <ConstitutionManagerNudgeBanner groupId={groupId} /> : null}
          {children}
        </>
      )}
    </DashboardShell>
  );
}
