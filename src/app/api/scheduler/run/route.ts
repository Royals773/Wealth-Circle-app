import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "@/lib/env";
import { flushPendingNotificationEmailsWith } from "@/lib/notifications/flush";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/types/database";

/**
 * Phase 9 scheduled-job trigger. Meant to be invoked on a schedule by an
 * external scheduler (GitHub Actions, Vercel Cron, pg_cron+pg_net, or
 * similar — the exact mechanism is a deployment decision, not made
 * here) hitting this URL with a bearer token. Runs the five idempotent
 * reminder/expiry functions from
 * supabase/migrations/0015_phase8_reports_notifications_audit.sql, plus
 * a notification-email flush — every one of those functions is
 * provably safe to call repeatedly (create_notification()'s
 * `dedupe_key` unique index makes a duplicate call a no-op), so
 * overlapping or duplicate invocations of this endpoint cannot
 * double-notify or double-email.
 *
 * Auth is a shared secret (SCHEDULER_SECRET), not SUPABASE_SECRET_KEY —
 * this endpoint gates one HTTP call, not database access. It signs in
 * as a dedicated, ordinary Supabase Auth account with no group
 * memberships (SCHEDULER_SUPABASE_EMAIL/PASSWORD) to call the existing
 * `authenticated`-granted RPCs, the same "narrowly-scoped function, not
 * an elevated bypass key" pattern used everywhere else in this app. See
 * docs/security-boundaries.md.
 */

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }

  const { SCHEDULER_SECRET, SCHEDULER_SUPABASE_EMAIL, SCHEDULER_SUPABASE_PASSWORD } = env;
  if (!SCHEDULER_SECRET || !SCHEDULER_SUPABASE_EMAIL || !SCHEDULER_SUPABASE_PASSWORD) {
    return NextResponse.json({ error: "Scheduled jobs are not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const providedSecret = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!providedSecret || !timingSafeEqualStrings(providedSecret, SCHEDULER_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: SCHEDULER_SUPABASE_EMAIL,
    password: SCHEDULER_SUPABASE_PASSWORD,
  });
  if (signInError) {
    return NextResponse.json({ error: "Scheduler account sign-in failed" }, { status: 500 });
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const [overdueContributions, overdueRepayments, governanceDeadlines, expiredInvitations, expiredTransfers] =
    await Promise.all([
      supabase.rpc("send_overdue_contribution_reminders", { p_today: today }),
      supabase.rpc("send_overdue_repayment_reminders", { p_today: today }),
      supabase.rpc("send_governance_deadline_reminders", { p_now: now }),
      supabase.rpc("expire_stale_invitations", { p_now: now }),
      supabase.rpc("expire_stale_ownership_transfers", { p_now: now }),
    ]);

  const flush = await flushPendingNotificationEmailsWith(supabase, 50);

  const summary = {
    overdueContributions: overdueContributions.data ?? 0,
    overdueRepayments: overdueRepayments.data ?? 0,
    governanceDeadlines: governanceDeadlines.data ?? 0,
    expiredInvitations: expiredInvitations.data ?? 0,
    expiredTransfers: expiredTransfers.data ?? 0,
    emailsSent: flush.sent,
    emailsFailed: flush.failed,
  };

  const rpcErrors = [overdueContributions, overdueRepayments, governanceDeadlines, expiredInvitations, expiredTransfers]
    .map((r) => r.error?.message)
    .filter((message): message is string => Boolean(message));

  if (rpcErrors.length > 0) {
    logger.error("Scheduled job run had RPC failures", { ...summary, errors: rpcErrors.join("; ") });
  } else {
    logger.info("Scheduled job run completed", summary);
  }

  return NextResponse.json(summary);
}
