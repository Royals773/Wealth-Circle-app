"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV_ITEMS, type NavItem } from "@/components/dashboard/nav-items";
import { Badge } from "@/components/ui/badge";

function groupNavItems(items: NavItem[]): { group: string | null; items: NavItem[] }[] {
  const sections: { group: string | null; items: NavItem[] }[] = [];
  for (const item of items) {
    const current = sections.at(-1);
    if (current && current.group === item.group) {
      current.items.push(item);
    } else {
      sections.push({ group: item.group, items: [item] });
    }
  }
  return sections;
}

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
  const sections = groupNavItems(DASHBOARD_NAV_ITEMS);

  return (
    <nav aria-label="Group sections" className="flex flex-col gap-4">
      {sections.map((section, index) => (
        <div key={section.group ?? `ungrouped-${index}`} className="flex flex-col gap-1">
          {section.group ? (
            <h3 className="mb-1 px-3 text-xs font-semibold tracking-wide text-sidebar-foreground/60 uppercase">
              {section.group}
            </h3>
          ) : null}
          {section.items.map((item) => {
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
                  "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar focus-visible:outline-none",
                  isActive
                    ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {isActive ? (
                  <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                ) : null}
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
        </div>
      ))}
    </nav>
  );
}
