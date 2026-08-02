"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { flushPendingNotificationEmailsWith } from "@/lib/notifications/flush";
import type { NotificationCategory } from "@/lib/types/database";

/** Categories that always email regardless of preference — mirrors the
 * essential-category list hardcoded inside create_notification() in
 * 0015_phase8_reports_notifications_audit.sql. Not offered as a toggle
 * in the preferences UI; also rejected here as defense-in-depth. */
const ESSENTIAL_CATEGORIES: NotificationCategory[] = ["membership", "ownership_transfer"];

export async function markNotificationReadAction(notificationId: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return {};

  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/[groupId]", "layout");
  return {};
}

export async function markAllNotificationsReadAction(): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return {};

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("recipient_id", user.id)
    .eq("is_read", false);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/[groupId]", "layout");
  return {};
}

export async function setNotificationPreferenceAction(
  category: NotificationCategory,
  emailEnabled: boolean,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return {};
  if (ESSENTIAL_CATEGORIES.includes(category)) {
    return { error: "This category cannot be disabled" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: user.id, category, email_enabled: emailEnabled }, { onConflict: "user_id,category" });

  if (error) return { error: error.message };
  revalidatePath("/dashboard/[groupId]/settings", "page");
  return {};
}

/**
 * Best-effort delivery of any emails queued by the mutation that just
 * ran. Called after every notification-emitting Server Action, and from
 * the Notifications page on load — Postgres can't send SMTP itself, so
 * this is the Next.js-layer half of the create_notification() pipeline.
 * Never throws: a failed flush leaves rows 'pending' for the next
 * opportunity, and the in-app notification already exists regardless.
 */
export async function flushPendingNotificationEmails(): Promise<void> {
  if (!isSupabaseConfigured) return;

  const supabase = await createClient();
  await flushPendingNotificationEmailsWith(supabase);
}
