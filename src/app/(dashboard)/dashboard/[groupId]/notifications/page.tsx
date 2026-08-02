import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Button } from "@/components/ui/button";
import { NotificationsList } from "@/components/dashboard/notifications-list";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { flushPendingNotificationEmails } from "@/lib/actions/notifications";
import { loadNotifications } from "@/lib/data/notification-summary";
import type { NotificationCategory } from "@/lib/types/database";

export const metadata: Metadata = { title: "Notifications" };

const CATEGORIES: NotificationCategory[] = [
  "invitation",
  "contribution",
  "loan",
  "repayment",
  "withdrawal",
  "governance",
  "membership",
  "ownership_transfer",
];

type SearchParams = Record<string, string | string[] | undefined>;

function param(sp: SearchParams, key: string): string | undefined {
  const value = sp[key];
  return Array.isArray(value) ? value[0] : value || undefined;
}

export default async function NotificationsPage({
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader
          title="Notifications"
          description="Updates about your groups — approvals, invitations and decisions that need your attention."
        />
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="You'll see notifications here when something in your groups needs your attention."
        />
      </div>
    );
  }

  const sp = await searchParams;
  const page = Number(param(sp, "page") ?? "0") || 0;
  const filterGroupId = param(sp, "group");
  const filterCategory = param(sp, "category") as NotificationCategory | undefined;

  // Best-effort: pick up anything queued by an action taken elsewhere
  // in the app that hasn't been flushed yet.
  await flushPendingNotificationEmails();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: memberships }, { rows, hasMore, unreadCount }] = await Promise.all([
    user
      ? supabase
          .from("group_memberships")
          .select("group_id, groups(name)")
          .eq("user_id", user.id)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    loadNotifications({ groupId: filterGroupId, category: filterCategory }, page),
  ]);

  const groupOptions = (memberships ?? [])
    .map((m) => {
      const groups = m.groups as unknown as { name: string } | { name: string }[] | null;
      const name = Array.isArray(groups) ? groups[0]?.name : groups?.name;
      return { id: m.group_id, name: name ?? "Untitled group" };
    })
    .filter((g): g is { id: string; name: string } => Boolean(g.id));

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Updates across every group you belong to — approvals, invitations and decisions that need your attention."
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="group" className="text-sm font-medium text-foreground">
            Group
          </label>
          <select
            id="group"
            name="group"
            defaultValue={filterGroupId ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All groups</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="category" className="text-sm font-medium text-foreground">
            Category
          </label>
          <select
            id="category"
            name="category"
            defaultValue={filterCategory ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="You'll see notifications here when something in your groups needs your attention."
        />
      ) : (
        <>
          <NotificationsList rows={rows} unreadCount={unreadCount} />
          {(page > 0 || hasMore) && (
            <div className="mt-6 flex items-center justify-between">
              <Button asChild variant="outline" disabled={page === 0}>
                <a
                  href={`?${new URLSearchParams({ ...(filterGroupId ? { group: filterGroupId } : {}), ...(filterCategory ? { category: filterCategory } : {}), page: String(Math.max(0, page - 1)) }).toString()}`}
                >
                  Previous
                </a>
              </Button>
              <Button asChild variant="outline" disabled={!hasMore}>
                <a
                  href={`?${new URLSearchParams({ ...(filterGroupId ? { group: filterGroupId } : {}), ...(filterCategory ? { category: filterCategory } : {}), page: String(page + 1) }).toString()}`}
                >
                  Next
                </a>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
