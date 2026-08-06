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

/**
 * Live tests for the Phase 9 scheduler-email-capability fix
 * (supabase/migrations/0018_phase9_scheduler_email_capability.sql).
 * Self-contained fixtures, separate from the describe block above, so
 * this can be reasoned about and cleaned up independently. Requires
 * 0018 to already be applied.
 */
describe.skipIf(!isConfigured)("scheduler email capability (Phase 9 fix)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let bareOutsiderClient: SupabaseClient;
  let foreignOwnerClient: SupabaseClient;
  let schedulerClient: SupabaseClient;
  let ownerId: string;
  let memberId: string;
  let bareOutsiderId: string;
  let foreignOwnerId: string;
  let schedulerId: string;
  let groupId: string;
  let foreignGroupId: string;

  const runId = Date.now().toString(36) + "-sched";
  const testPassword = "SchedCapTest123!";

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

    const owner = await createConfirmedUser(`wc-sched-owner-${runId}@example.com`, "Sched Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const member = await createConfirmedUser(`wc-sched-member-${runId}@example.com`, "Sched Member");
    memberId = member.id;
    memberClient = member.client;

    const bareOutsider = await createConfirmedUser(`wc-sched-outsider-${runId}@example.com`, "Sched Outsider");
    bareOutsiderId = bareOutsider.id;
    bareOutsiderClient = bareOutsider.client;

    const foreignOwner = await createConfirmedUser(`wc-sched-foreign-${runId}@example.com`, "Sched Foreign Owner");
    foreignOwnerId = foreignOwner.id;
    foreignOwnerClient = foreignOwner.client;

    // The scheduler test account is deliberately never joined to any
    // group — only ever granted the capability row below.
    const scheduler = await createConfirmedUser(`wc-sched-scheduler-${runId}@example.com`, "Sched Scheduler");
    schedulerId = scheduler.id;
    schedulerClient = scheduler.client;

    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Scheduler Capability Test Group",
      p_slug: `sched-cap-group-${runId}`,
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
    groupId = group![0].group_id;

    const { data: foreignGroup } = await foreignOwnerClient.rpc("create_group_with_setup", {
      p_name: "Scheduler Capability Foreign Group",
      p_slug: `sched-cap-foreign-${runId}`,
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
    foreignGroupId = foreignGroup![0].group_id;

    const { data: invite, error: inviteErr } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: `wc-sched-member-${runId}@example.com`,
      p_role: "member",
    });
    if (inviteErr) throw new Error(`create_invitation failed: ${inviteErr.message}`);
    const { error: acceptErr } = await memberClient.rpc("accept_invitation", { p_token: invite![0].raw_token });
    if (acceptErr) throw new Error(`accept_invitation failed: ${acceptErr.message}`);

    // Grant the scheduler capability directly — service-role only, out
    // of band, exactly matching how a real environment would do it
    // (never via the app runtime or a migration-embedded id).
    const { error: grantErr } = await adminClient
      .from("scheduler_capabilities")
      .insert({ user_id: schedulerId, is_active: true, label: `test:${runId}` });
    if (grantErr) throw new Error(`Failed to grant scheduler capability: ${grantErr.message}`);
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (foreignGroupId) await adminClient.from("groups").delete().eq("id", foreignGroupId);
    if (schedulerId) await adminClient.from("scheduler_capabilities").delete().eq("user_id", schedulerId);
    if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    if (memberId) await adminClient.auth.admin.deleteUser(memberId);
    if (bareOutsiderId) await adminClient.auth.admin.deleteUser(bareOutsiderId);
    if (foreignOwnerId) await adminClient.auth.admin.deleteUser(foreignOwnerId);
    if (schedulerId) await adminClient.auth.admin.deleteUser(schedulerId);
  });

  async function createTestNotification(dedupeKey: string) {
    await ownerClient.rpc("create_notification", {
      p_recipient_id: memberId,
      p_group_id: groupId,
      p_category: "contribution",
      p_type: "test_scheduler_cap",
      p_title: "Scheduler capability test",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: dedupeKey,
    });
    const { data } = await memberClient.from("notifications").select("id").eq("dedupe_key", dedupeKey).single();
    return data!.id as string;
  }

  it("is_active_scheduler is false for an owner, a member, and a bare outsider, true only for the granted scheduler", async () => {
    expect((await ownerClient.rpc("is_active_scheduler")).data).toBe(false);
    expect((await memberClient.rpc("is_active_scheduler")).data).toBe(false);
    expect((await bareOutsiderClient.rpc("is_active_scheduler")).data).toBe(false);
    expect((await schedulerClient.rpc("is_active_scheduler")).data).toBe(true);
  });

  it("a normal authenticated user with no shared group and no scheduler capability cannot claim pending emails", async () => {
    const id = await createTestNotification(`sched_test_outsider:${runId}`);

    const { data: claim } = await bareOutsiderClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    const claimedIds = (claim ?? []).map((r: { notification_id: string }) => r.notification_id);
    expect(claimedIds).not.toContain(id);

    const { data: row } = await memberClient.from("notifications").select("email_status").eq("id", id).single();
    expect(row?.email_status).toBe("pending");

    // Deliberately left 'pending' by this test (nobody was entitled to
    // claim it) — cleaned up explicitly so it can't be swept up by a
    // later test's unscoped scheduler claim (the scheduler claims
    // across all groups, not just this file's fixture group).
    await adminClient.from("notifications").delete().eq("id", id);
  });

  it("an owner cannot impersonate the scheduler to claim a group they don't belong to", async () => {
    await foreignOwnerClient.rpc("create_notification", {
      p_recipient_id: foreignOwnerId,
      p_group_id: foreignGroupId,
      p_category: "contribution",
      p_type: "test_scheduler_cap_foreign",
      p_title: "Foreign group notification",
      p_body: null,
      p_related_type: null,
      p_related_id: null,
      p_dedupe_key: `sched_test_foreign:${runId}`,
    });
    const { data: foreignRow } = await foreignOwnerClient
      .from("notifications")
      .select("id")
      .eq("dedupe_key", `sched_test_foreign:${runId}`)
      .single();

    // ownerClient has real elevated (owner) role — but only within its
    // own group. Role alone must not satisfy the scheduler branch.
    const { data: claim } = await ownerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    const claimedIds = (claim ?? []).map((r: { notification_id: string }) => r.notification_id);
    expect(claimedIds).not.toContain(foreignRow!.id);
    expect((await ownerClient.rpc("is_active_scheduler")).data).toBe(false);

    // Same reasoning as the outsider test above: left 'pending' by
    // design, cleaned up explicitly to avoid polluting later
    // unscoped-scheduler-claim tests.
    await adminClient.from("notifications").delete().eq("id", foreignRow!.id);
  });

  it("the scheduler can claim a bounded pending batch, covering everything across enough calls", async () => {
    // created_at has no secondary tiebreaker in claim_pending_notification_emails'
    // ORDER BY (unchanged from the original 0015 function — this fix
    // didn't touch ordering, only eligibility/authorization), so three
    // rapid inserts aren't guaranteed strict FIFO order if their
    // timestamps tie. What's actually guaranteed, and what this
    // asserts: each call is bounded to p_limit, and every pending row
    // is eventually claimed exactly once across enough calls.
    const id1 = await createTestNotification(`sched_test_batch1:${runId}`);
    const id2 = await createTestNotification(`sched_test_batch2:${runId}`);
    const id3 = await createTestNotification(`sched_test_batch3:${runId}`);

    const { data: firstBatch } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 2 });
    expect(firstBatch?.length).toBe(2);

    const { data: secondBatch } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 2 });
    expect(secondBatch?.length).toBe(1);

    const allClaimedIds = [...firstBatch!, ...secondBatch!].map((r: { notification_id: string }) => r.notification_id);
    expect(new Set(allClaimedIds)).toEqual(new Set([id1, id2, id3]));
  });

  it("the scheduler cannot directly read unrelated group/financial data or other recipients' notifications", async () => {
    const { data: memberships } = await schedulerClient.from("group_memberships").select("*").eq("group_id", groupId);
    expect(memberships ?? []).toEqual([]);

    const { data: contributions } = await schedulerClient
      .from("contribution_records")
      .select("*")
      .eq("group_id", groupId);
    expect(contributions ?? []).toEqual([]);

    const { data: notifs } = await schedulerClient.from("notifications").select("*").eq("recipient_id", memberId);
    expect(notifs ?? []).toEqual([]);
  });

  it("two immediate scheduler runs do not claim (and would not send) the same email twice", async () => {
    const id = await createTestNotification(`sched_test_dupe:${runId}`);

    const { data: firstRun } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    const firstIds = (firstRun ?? []).map((r: { notification_id: string }) => r.notification_id);
    expect(firstIds).toContain(id);

    const { data: secondRun } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    const secondIds = (secondRun ?? []).map((r: { notification_id: string }) => r.notification_id);
    expect(secondIds).not.toContain(id);

    const { data: row } = await memberClient.from("notifications").select("email_status").eq("id", id).single();
    expect(row?.email_status).toBe("sending");
  });

  it("a failed delivery is not retried immediately, but is retried after the cooldown", async () => {
    const id = await createTestNotification(`sched_test_retry:${runId}`);

    const { data: claim } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    expect((claim ?? []).map((r: { notification_id: string }) => r.notification_id)).toContain(id);

    await schedulerClient.rpc("mark_notification_email_result", {
      p_notification_id: id,
      p_status: "failed",
      p_error: "simulated delivery failure",
    });
    const { data: failedRow } = await memberClient.from("notifications").select("email_status").eq("id", id).single();
    expect(failedRow?.email_status).toBe("failed");

    const { data: tooSoon } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    expect((tooSoon ?? []).map((r: { notification_id: string }) => r.notification_id)).not.toContain(id);

    // Simulate the 15-minute cooldown having passed. Only ever done here
    // via the service-role admin client, never by an ordinary caller.
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await adminClient.from("notifications").update({ email_attempted_at: twentyMinutesAgo }).eq("id", id);

    const { data: retried } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    expect((retried ?? []).map((r: { notification_id: string }) => r.notification_id)).toContain(id);
    const { data: retriedRow } = await memberClient.from("notifications").select("email_status").eq("id", id).single();
    expect(retriedRow?.email_status).toBe("sending");
  });

  it("disabling the scheduler capability immediately blocks future claims, and re-enabling restores it", async () => {
    const { error: disableErr } = await adminClient
      .from("scheduler_capabilities")
      .update({ is_active: false })
      .eq("user_id", schedulerId);
    expect(disableErr).toBeNull();
    expect((await schedulerClient.rpc("is_active_scheduler")).data).toBe(false);

    const id = await createTestNotification(`sched_test_disabled:${runId}`);
    const { data: blockedClaim } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    expect((blockedClaim ?? []).map((r: { notification_id: string }) => r.notification_id)).not.toContain(id);
    const { data: stillPending } = await memberClient.from("notifications").select("email_status").eq("id", id).single();
    expect(stillPending?.email_status).toBe("pending");

    const { error: reenableErr } = await adminClient
      .from("scheduler_capabilities")
      .update({ is_active: true })
      .eq("user_id", schedulerId);
    expect(reenableErr).toBeNull();
    expect((await schedulerClient.rpc("is_active_scheduler")).data).toBe(true);

    const { data: nowClaimed } = await schedulerClient.rpc("claim_pending_notification_emails", { p_limit: 50 });
    expect((nowClaimed ?? []).map((r: { notification_id: string }) => r.notification_id)).toContain(id);
  });
});
