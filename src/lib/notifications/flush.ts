import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUrl } from "@/lib/env";
import { sendNotificationEmail } from "@/lib/email/mailer";
import type { Database } from "@/lib/types/database";

export interface FlushResult {
  sent: number;
  failed: number;
}

/**
 * Claims and sends up to `limit` pending notification emails using the
 * given, already-authenticated Supabase client. Extracted from
 * src/lib/actions/notifications.ts (which still exports the original
 * flushPendingNotificationEmails() as a thin wrapper around this, for
 * every existing call site) so the Phase 9 scheduler endpoint
 * (src/app/api/scheduler/run/route.ts — a dedicated, non-cookie-based
 * session, not the signed-in visitor's) can share the exact same logic
 * instead of duplicating it.
 */
export async function flushPendingNotificationEmailsWith(
  supabase: SupabaseClient<Database>,
  limit = 10,
): Promise<FlushResult> {
  const { data, error } = await supabase.rpc("claim_pending_notification_emails", { p_limit: limit });
  if (error || !data) return { sent: 0, failed: 0 };

  const appUrl = getAppUrl();
  let sent = 0;
  let failed = 0;

  for (const item of data) {
    const result = await sendNotificationEmail({
      to: item.recipient_email,
      title: item.subject,
      actionUrl: `${appUrl}${item.action_path}`,
    });

    await supabase.rpc("mark_notification_email_result", {
      p_notification_id: item.notification_id,
      p_status: result.ok ? "sent" : "failed",
      p_error: result.error ?? null,
    });

    if (result.ok) sent += 1;
    else failed += 1;
  }

  return { sent, failed };
}
