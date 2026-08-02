import { createClient } from "@/lib/supabase/server";
import type { NotificationCategory } from "@/lib/types/database";

export interface NotificationRow {
  id: string;
  groupId: string | null;
  groupName: string | null;
  category: NotificationCategory | null;
  title: string;
  body: string | null;
  isRead: boolean;
  relatedType: string | null;
  relatedId: string | null;
  createdAt: string;
}

export interface NotificationFilters {
  groupId?: string;
  category?: NotificationCategory;
  unreadOnly?: boolean;
}

const PAGE_SIZE = 20;

/** The signed-in user's own notifications only — RLS
 * (notifications_select_recipient) already enforces this identically,
 * this loader is purely for display convenience (group name resolution,
 * pagination). Deliberately not scoped to one group by default: this is
 * a cross-group notification centre, with group as an optional filter. */
export async function loadNotifications(
  filters: NotificationFilters = {},
  page = 0,
): Promise<{ rows: NotificationRow[]; hasMore: boolean; unreadCount: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { rows: [], hasMore: false, unreadCount: 0 };

  let query = supabase
    .from("notifications")
    .select("id, group_id, category, title, body, is_read, related_type, related_id, created_at")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (filters.groupId) query = query.eq("group_id", filters.groupId);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.unreadOnly) query = query.eq("is_read", false);

  const [{ data }, { count: unreadCount }] = await Promise.all([
    query,
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .eq("is_read", false),
  ]);

  const rawRows = data ?? [];
  const groupIds = [...new Set(rawRows.map((r) => r.group_id).filter((id): id is string => Boolean(id)))];
  const { data: groups } =
    groupIds.length > 0 ? await supabase.from("groups").select("id, name").in("id", groupIds) : { data: [] };
  const groupNameById = new Map((groups ?? []).map((g) => [g.id, g.name]));

  const rows: NotificationRow[] = rawRows.slice(0, PAGE_SIZE).map((r) => ({
    id: r.id,
    groupId: r.group_id,
    groupName: r.group_id ? (groupNameById.get(r.group_id) ?? null) : null,
    category: r.category,
    title: r.title,
    body: r.body,
    isRead: r.is_read,
    relatedType: r.related_type,
    relatedId: r.related_id,
    createdAt: r.created_at,
  }));

  return { rows, hasMore: rawRows.length > PAGE_SIZE, unreadCount: unreadCount ?? 0 };
}

/** Cheap unread count for the nav badge — no row data, just the count. */
export async function loadUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .eq("is_read", false);

  return count ?? 0;
}
