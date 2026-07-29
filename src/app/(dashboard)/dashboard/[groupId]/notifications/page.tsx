import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  isRead: boolean;
  createdAt: string;
}

async function loadNotifications(): Promise<NotificationRow[]> {
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, is_read, created_at")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    isRead: row.is_read,
    createdAt: row.created_at,
  }));
}

export default async function NotificationsPage() {
  const notifications = await loadNotifications();

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Updates about your groups — approvals, invitations and decisions that need your attention."
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="You're all caught up"
          description="You'll see notifications here when something in your groups needs your attention."
        />
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{notification.title}</p>
                {notification.body ? (
                  <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(notification.createdAt).toLocaleString()}
                </p>
              </div>
              {!notification.isRead ? <Badge>New</Badge> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
