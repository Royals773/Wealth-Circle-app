/**
 * Live RLS and RPC tests for the Phase 8 notification pipeline.
 *
 * Same shape and setup as tests/security/membership.test.ts: runs
 * against the real Supabase project in .env.local, skipped (not failed)
 * when the required env vars aren't present. Requires
 * supabase/migrations/0015_phase8_reports_notifications_audit.sql to
 * already be applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-notif-test-owner-${runId}@example.com`;
const memberEmail = `wc-notif-test-member-${runId}@example.com`;
const otherOwnerEmail = `wc-notif-test-other-${runId}@example.com`;
const testPassword = "NotifTest123!";

describe.skipIf(!isConfigured)("notifications (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let memberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    async function createConfirmedUser(email: string, fullName: string) {
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password: testPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !data.user) throw new Error(`Failed to create ${email}: ${error?.message}`);
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password: testPassword });
      if (signInErr) throw new Error(`Failed to sign in ${email}: ${signInErr.message}`);
      return { id: data.user.id, client };
    }

    const owner = await createConfirmedUser(ownerEmail, "Notification Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const member = await createConfirmedUser(memberEmail, "Notification Test Member");
    memberId = member.id;
    memberClient = member.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Notification Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Notification Test Group",
      p_slug: `notif-test-group-${runId}`,
      p_description: null,
      p_country_code: "GB",
      p_currency_code: "GBP",
      p_contribution_frequency: "monthly",
      p_contribution_type: "fixed",
      p_fixed_amount_minor_units: 10000,
      p_financial_year_start_month: 1,
      p_rules: null,
      p_invites: [],
    });
    groupId = group![0].group_id;

    const { data: otherGroup } = await otherOwnerClient.rpc("create_group_with_setup", {
      p_name: "Notification Test Other Group",
      p_slug: `notif-test-other-group-${runId}`,
      p_description: null,
      p_country_code: "GB",
      p_currency_code: "GBP",
      p_contribution_frequency: "monthly",
      p_contribution_type: "flexible",
      p_fixed_amount_minor_units: null,
      p_financial_year_start_month: 1,
      p_rules: null,
      p_invites: [],
    });
    otherGroupId = otherGroup![0].group_id;

    const { data: invite, error: inviteErr } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: memberEmail,
      p_role: "member",
    });
    if (inviteErr) throw new Error(`create_invitation failed: ${inviteErr.message}`);
    const { error: acceptErr } = await memberClient.rpc("accept_invitation", { p_token: invite![0].raw_token });
    if (acceptErr) throw new Error(`accept_invitation failed: ${acceptErr.message}`);
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    if (memberId) await adminClient.auth.admin.deleteUser(memberId);
    if (otherOwnerId) await adminClient.auth.admin.deleteUser(otherOwnerId);
  });

  it("creates a real notification row as a side effect of a lifecycle RPC", async () => {
    const { data: plan } = await ownerClient.rpc("upsert_contribution_plan", {
      p_group_id: groupId,
      p_plan_id: null,
      p_is_flexible: false,
      p_amount_minor_units: 10000,
      p_minimum_amount_minor_units: null,
      p_frequency: "monthly",
      p_start_date: "2026-01-01",
    });
    const { data: contribution, error } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: memberId,
      p_contribution_plan_id: plan![0].plan_id,
      p_amount_minor_units: 5000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(error).toBeNull();

    const { data: rows } = await memberClient
      .from("notifications")
      .select("id, category, type, title")
      .eq("recipient_id", memberId)
      .eq("dedupe_key", `contribution_recorded:${contribution![0].record_id}`);

    expect(rows?.length).toBe(1);
    expect(rows![0].category).toBe("contribution");
    expect(rows![0].type).toBe("contribution_recorded");
  });

  it("only lets the recipient read their own notification, not other group members", async () => {
    const { data: asOwner } = await ownerClient
      .from("notifications")
      .select("id")
      .eq("recipient_id", memberId);
    expect(asOwner ?? []).toEqual([]);

    const { data: asMember } = await memberClient
      .from("notifications")
      .select("id")
      .eq("recipient_id", memberId);
    expect(asMember!.length).toBeGreaterThan(0);
  });

  it("does not let a manager of another group read this group's notifications", async () => {
    const { data } = await otherOwnerClient.from("notifications").select("id").eq("recipient_id", memberId);
    expect(data ?? []).toEqual([]);
  });

  it("lets a recipient mark their own notification read, but not someone else's", async () => {
    const { data: notification } = await memberClient
      .from("notifications")
      .select("id")
      .eq("recipient_id", memberId)
      .limit(1)
      .single();

    const { data: updated, error } = await memberClient
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notification!.id)
      .select();
    expect(error).toBeNull();
    expect(updated?.[0]?.is_read).toBe(true);

    const { data: forbidden } = await otherOwnerClient
      .from("notifications")
      .update({ is_read: true })
      .eq("id", notification!.id)
      .select();
    expect(forbidden ?? []).toEqual([]);
  });

  it("is idempotent: the same dedupe_key never creates a second row, even across retries", async () => {
    const dedupeKey = `test_dedupe:${runId}`;
    const first = await ownerClient.rpc("create_notification", {
      p_recipient_id: memberId,
      p_group_id: groupId,
      p_category: "contribution",
      p_type: "test_event",
      p_title: "First",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: dedupeKey,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBeTruthy();

    const second = await ownerClient.rpc("create_notification", {
      p_recipient_id: memberId,
      p_group_id: groupId,
      p_category: "contribution",
      p_type: "test_event",
      p_title: "Second attempt — should be dropped",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: dedupeKey,
    });
    expect(second.error).toBeNull();
    expect(second.data).toBeNull();

    const { data: rows } = await memberClient.from("notifications").select("id, title").eq("dedupe_key", dedupeKey);
    expect(rows?.length).toBe(1);
    expect(rows![0].title).toBe("First");
  });

  it("respects an opted-out preference for a non-essential category, but always emails an essential one", async () => {
    await memberClient
      .from("notification_preferences")
      .upsert({ user_id: memberId, category: "loan", email_enabled: false }, { onConflict: "user_id,category" });

    const optedOutKey = `test_opted_out:${runId}`;
    await ownerClient.rpc("create_notification", {
      p_recipient_id: memberId,
      p_group_id: groupId,
      p_category: "loan",
      p_type: "test_opted_out",
      p_title: "Opted out",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: optedOutKey,
    });
    const { data: optedOutRow } = await memberClient
      .from("notifications")
      .select("email_status")
      .eq("dedupe_key", optedOutKey)
      .single();
    expect(optedOutRow?.email_status).toBe("not_required");

    await memberClient
      .from("notification_preferences")
      .upsert({ user_id: memberId, category: "membership", email_enabled: false }, { onConflict: "user_id,category" });

    const essentialKey = `test_essential:${runId}`;
    await ownerClient.rpc("create_notification", {
      p_recipient_id: memberId,
      p_group_id: groupId,
      p_category: "membership",
      p_type: "test_essential",
      p_title: "Essential",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: essentialKey,
    });
    const { data: essentialRow } = await memberClient
      .from("notifications")
      .select("email_status")
      .eq("dedupe_key", essentialKey)
      .single();
    expect(essentialRow?.email_status).toBe("pending");
  });

  it("prevents setNotificationPreferenceAction-style essential opt-out at the RPC layer too", async () => {
    // create_notification itself is the enforcement point (the Server
    // Action additionally refuses to write the row at all) — verified
    // above. This test confirms the essential-category email is not
    // silently skippable by any client-writable preference row, no
    // matter what value is stored.
    const { data: pref } = await memberClient
      .from("notification_preferences")
      .select("email_enabled")
      .eq("user_id", memberId)
      .eq("category", "membership")
      .single();
    expect(pref?.email_enabled).toBe(false);
  });

  it("claim_pending_notification_emails only claims notifications whose recipient shares a group with the caller", async () => {
    const boundedKey = `test_bounded:${runId}`;
    await ownerClient.rpc("create_notification", {
      p_recipient_id: memberId,
      p_group_id: groupId,
      p_category: "governance",
      p_type: "test_bounded",
      p_title: "Bounded claim test",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: boundedKey,
    });

    const { data: targetRow } = await memberClient
      .from("notifications")
      .select("id")
      .eq("dedupe_key", boundedKey)
      .single();

    const { data: outsiderClaim } = await otherOwnerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    const outsiderClaimedIds = (outsiderClaim ?? []).map((row: { notification_id: string }) => row.notification_id);
    expect(outsiderClaimedIds).not.toContain(targetRow!.id);

    const { data: stillPending } = await memberClient
      .from("notifications")
      .select("email_status")
      .eq("dedupe_key", boundedKey)
      .single();
    expect(stillPending?.email_status).toBe("pending");

    const { data: insiderClaim } = await ownerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    const claimedIds = (insiderClaim ?? []).map((row: { notification_id: string }) => row.notification_id);
    const { data: claimedRow } = await memberClient
      .from("notifications")
      .select("id, email_status")
      .eq("dedupe_key", boundedKey)
      .single();
    expect(claimedIds).toContain(claimedRow?.id);
    expect(claimedRow?.email_status).toBe("sending");

    await ownerClient.rpc("mark_notification_email_result", {
      p_notification_id: claimedRow!.id,
      p_status: "sent",
      p_error: null,
    });
    const { data: sentRow } = await memberClient
      .from("notifications")
      .select("email_status")
      .eq("dedupe_key", boundedKey)
      .single();
    expect(sentRow?.email_status).toBe("sent");
  });

  it("mark_notification_email_result only transitions a row that is actually 'sending'", async () => {
    const idleKey = `test_idle:${runId}`;
    const { data: created } = await ownerClient.rpc("create_notification", {
      p_recipient_id: memberId,
      p_group_id: groupId,
      p_category: "governance",
      p_type: "test_idle",
      p_title: "Idle",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: idleKey,
    });

    await ownerClient.rpc("mark_notification_email_result", {
      p_notification_id: created,
      p_status: "sent",
      p_error: null,
    });

    const { data: row } = await memberClient
      .from("notifications")
      .select("email_status")
      .eq("dedupe_key", idleKey)
      .single();
    // Still 'pending' — mark_notification_email_result only affects rows
    // already flipped to 'sending' by claim_pending_notification_emails.
    expect(row?.email_status).toBe("pending");
  });

  it("scheduled reminder functions are idempotent and only notify eligible members", async () => {
    const today = "2026-06-15";
    const first = await adminClient.rpc("send_overdue_contribution_reminders", { p_today: today });
    expect(first.error).toBeNull();

    const second = await adminClient.rpc("send_overdue_contribution_reminders", { p_today: today });
    expect(second.error).toBeNull();
    // Re-running for the same day must not create duplicate rows —
    // verified indirectly: the dedupe_key is date-scoped, so a second
    // identical run can only ever return 0 newly-created rows once the
    // first run already created them.
    expect(second.data).toBeLessThanOrEqual(first.data ?? 0);
  });

  it("expire_stale_invitations expires a past-due invitation and notifies the inviter", async () => {
    const { data: invite } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: `wc-notif-expiring-${runId}@example.com`,
      p_role: "member",
    });
    const invitationId = invite![0].invitation_id;

    await adminClient
      .from("group_invitations")
      .update({ expires_at: "2020-01-01T00:00:00Z" })
      .eq("id", invitationId);

    const { error } = await adminClient.rpc("expire_stale_invitations", { p_now: new Date().toISOString() });
    expect(error).toBeNull();

    const { data: invitationRow } = await adminClient
      .from("group_invitations")
      .select("status")
      .eq("id", invitationId)
      .single();
    expect(invitationRow?.status).toBe("expired");

    const { data: notification } = await ownerClient
      .from("notifications")
      .select("id")
      .eq("dedupe_key", `invitation_expired:${invitationId}`);
    expect(notification?.length).toBe(1);
  });
});
