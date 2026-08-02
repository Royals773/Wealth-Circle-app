"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/actions/notifications";
import type { NotificationRow } from "@/lib/data/notification-summary";
import type { NotificationCategory } from "@/lib/types/database";

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  invitation: "Invitations",
  contribution: "Contributions",
  loan: "Loans",
  repayment: "Repayments",
  withdrawal: "Withdrawals",
  governance: "Governance",
  membership: "Membership",
  ownership_transfer: "Ownership",
};

/** Every category links back to the relevant section page for that
 * group — never a record-specific URL that might not re-check
 * permission on its own. Landing there always goes through the normal
 * page-level auth + RLS check, so possessing a notification link never
 * grants access beyond what the recipient already has. */
function categoryPath(groupId: string | null, category: NotificationCategory | null): string {
  if (!groupId) return "/dashboard";
  switch (category) {
    case "contribution":
      return `/dashboard/${groupId}/contributions`;
    case "loan":
      return `/dashboard/${groupId}/loans`;
    case "repayment":
      return `/dashboard/${groupId}/repayments`;
    case "withdrawal":
      return `/dashboard/${groupId}/withdrawals`;
    case "governance":
      return `/dashboard/${groupId}/governance`;
    case "membership":
    case "ownership_transfer":
      return `/dashboard/${groupId}/members`;
    case "invitation":
      return `/dashboard/${groupId}/members`;
    default:
      return `/dashboard/${groupId}`;
  }
}

export function NotificationsList({ rows, unreadCount }: { rows: NotificationRow[]; unreadCount: number }) {
  const [dismissedUnread, setDismissedUnread] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markOne(id: string) {
    setError(null);
    setDismissedUnread((prev) => new Set(prev).add(id));
    startTransition(async () => {
      const result = await markNotificationReadAction(id);
      if (result.error) setError(result.error);
    });
  }

  function markAll() {
    setError(null);
    setDismissedUnread(new Set(rows.filter((r) => !r.isRead).map((r) => r.id)));
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (result.error) setError(result.error);
    });
  }

  const effectiveUnreadCount = Math.max(0, unreadCount - dismissedUnread.size);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {effectiveUnreadCount > 0 ? `${effectiveUnreadCount} unread` : "You're all caught up"}
        </p>
        {effectiveUnreadCount > 0 ? (
          <Button variant="outline" size="sm" disabled={isPending} onClick={markAll}>
            <CheckCheck className="mr-1.5 h-4 w-4" />
            Mark all read
          </Button>
        ) : null}
      </div>

      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}

      <ul className="space-y-2">
        {rows.map((notification) => {
          const isRead = notification.isRead || dismissedUnread.has(notification.id);
          return (
            <li
              key={notification.id}
              className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
                isRead ? "border-border bg-card" : "border-primary/30 bg-primary/5"
              }`}
            >
              <Link
                href={categoryPath(notification.groupId, notification.category)}
                className="min-w-0 flex-1"
                onClick={() => !isRead && markOne(notification.id)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {notification.category ? (
                    <Badge variant="outline" className="text-xs">
                      {CATEGORY_LABELS[notification.category]}
                    </Badge>
                  ) : null}
                  {notification.groupName ? (
                    <span className="text-xs text-muted-foreground">{notification.groupName}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">{notification.title}</p>
                {notification.body ? (
                  <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(notification.createdAt).toLocaleString("en-GB")}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                {!isRead ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Mark as read"
                    disabled={isPending}
                    onClick={() => markOne(notification.id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
