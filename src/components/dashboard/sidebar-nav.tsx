"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV_ITEMS } from "@/components/dashboard/nav-items";
import { Badge } from "@/components/ui/badge";

export function SidebarNav({
  groupId,
  unreadNotificationCount = 0,
  onNavigate,
}: {
  groupId: string;
  unreadNotificationCount?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const basePath = `/dashboard/${groupId}`;

  return (
    <nav aria-label="Group sections" className="flex flex-col gap-1">
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const href = item.segment ? `${basePath}/${item.segment}` : basePath;
        const isActive = pathname === href;
        const showUnreadBadge = item.segment === "notifications" && unreadNotificationCount > 0;

        return (
          <Link
            key={item.label}
            href={href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <item.icon aria-hidden className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {showUnreadBadge ? (
              <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1 text-xs">
                {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
              </Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
