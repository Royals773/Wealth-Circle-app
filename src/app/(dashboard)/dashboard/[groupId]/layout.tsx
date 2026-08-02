import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getDashboardContext } from "@/lib/data/dashboard";
import { loadUnreadNotificationCount } from "@/lib/data/notification-summary";

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
      {children}
    </DashboardShell>
  );
}
