/**
 * Live RLS and RPC tests for the Phase 7 member and role management
 * model. Same shape and setup as tests/security/governance.test.ts: runs
 * against the real Supabase project in .env.local, skipped (not failed)
 * when the required env vars aren't present. Requires
 * supabase/migrations/0013_phase7_member_management.sql to already be
 * applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateTestPassword } from "./test-fixtures";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-mem-test-owner-${runId}@example.com`;
const adminEmail = `wc-mem-test-admin-${runId}@example.com`;
const targetEmail = `wc-mem-test-target-${runId}@example.com`;
const loanMemberEmail = `wc-mem-test-loanmember-${runId}@example.com`;
const otherOwnerEmail = `wc-mem-test-otherowner-${runId}@example.com`;
const testPassword = generateTestPassword();

describe.skipIf(!isConfigured)("member and role management (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let administratorClient: SupabaseClient;
  let targetClient: SupabaseClient;
  let loanMemberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let administratorId: string;
  let targetId: string;
  let loanMemberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;
  const createdUserIds: string[] = [];

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
      createdUserIds.push(data.user.id);
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password: testPassword });
      if (signInErr) throw new Error(`Failed to sign in ${email}: ${signInErr.message}`);
      return { id: data.user.id, client };
    }

    const owner = await createConfirmedUser(ownerEmail, "Membership Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const administrator = await createConfirmedUser(adminEmail, "Membership Test Administrator");
    administratorId = administrator.id;
    administratorClient = administrator.client;

    const target = await createConfirmedUser(targetEmail, "Membership Test Target");
    targetId = target.id;
    targetClient = target.client;

    const loanMember = await createConfirmedUser(loanMemberEmail, "Membership Test Loan Member");
    loanMemberId = loanMember.id;
    loanMemberClient = loanMember.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Membership Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    await adminClient.from("organiser_applications").insert({ user_id: ownerId, status: "approved" });
    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Membership Test Group",
      p_slug: `mem-test-group-${runId}`,
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
    await adminClient.from("groups").update({ status: "active" }).eq("id", groupId);

    await adminClient.from("organiser_applications").insert({ user_id: otherOwnerId, status: "approved" });
    const { data: otherGroup } = await otherOwnerClient.rpc("create_group_with_setup", {
      p_name: "Membership Test Other Group",
      p_slug: `mem-test-other-group-${runId}`,
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
    await adminClient.from("groups").update({ status: "active" }).eq("id", otherGroupId);

    async function invite(email: string, role: string) {
      const { data } = await ownerClient.rpc("create_invitation", {
        p_group_id: groupId,
        p_email: email,
        p_role: role,
      });
      return data![0].raw_token as string;
    }

    await administratorClient.rpc("accept_invitation", { p_token: await invite(adminEmail, "administrator") });
    await targetClient.rpc("accept_invitation", { p_token: await invite(targetEmail, "member") });
    await loanMemberClient.rpc("accept_invitation", { p_token: await invite(loanMemberEmail, "member") });

    // Give loanMember enough verified contributions and an active loan,
    // for the removal-blocker test below.
    const { data: plan } = await ownerClient.rpc("upsert_contribution_plan", {
      p_group_id: groupId,
      p_plan_id: null,
      p_is_flexible: false,
      p_amount_minor_units: 10000,
      p_minimum_amount_minor_units: null,
      p_frequency: "monthly",
      p_start_date: "2026-01-01",
    });
    const { data: contribution } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: loanMemberId,
      p_contribution_plan_id: plan![0].plan_id,
      p_amount_minor_units: 10000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    await ownerClient.rpc("verify_contribution", { p_record_id: contribution![0].record_id });
    await ownerClient.rpc("reconcile_contribution", { p_record_id: contribution![0].record_id });

    await ownerClient.rpc("upsert_loan_product", {
      p_group_id: groupId,
      p_product_id: null,
      p_enabled: true,
      p_max_loan_bps_of_contributions: 9500,
      p_max_amount_minor_units: null,
      p_interest_type: "one_time_flat",
      p_interest_rate_bps: 500,
      p_min_term_months: 1,
      p_max_term_months: 12,
      p_repayment_frequency: "monthly",
      p_allow_overdue_members: true,
      p_grace_period_days: 0,
    });

    // apply_for_loan / decide_loan_application / record_disbursement are
    // gated (supabase/migrations/0021_gate_lending_pending_legal_review.sql)
    // pending UK legal/regulatory review — not touched by this test file.
    // This fixture only needs a real 'active' loans row to exist for the
    // removal-blocker test below, so it's inserted directly via the
    // service-role client instead: the same "genuinely backend-only
    // fixture setup" use of adminClient already established elsewhere in
    // this file (user creation/cleanup), not a way around the gate for
    // anything a real session could do.
    const { error: loanFixtureError } = await adminClient.from("loans").insert({
      group_id: groupId,
      borrower_id: loanMemberId,
      principal_minor_units: 5000,
      currency_code: "GBP",
      interest_rate_bps: 500,
      term_months: 6,
      interest_amount_minor_units: 250,
      total_repayable_minor_units: 5250,
      repayment_frequency: "monthly",
      status: "active",
      disbursed_by: ownerId,
      disbursed_at: new Date().toISOString(),
      disbursement_date: "2026-02-01",
      disbursement_reference: "MEM-TEST-REF",
    });
    if (loanFixtureError) throw new Error(`Failed to seed active-loan fixture: ${loanFixtureError.message}`);
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    if (createdUserIds.length) {
      await adminClient.from("organiser_applications").delete().in("user_id", createdUserIds);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  it("requires a non-empty reason to change a member's role", async () => {
    const { error } = await administratorClient.rpc("change_member_role", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_new_role: "treasurer",
      p_reason: "   ",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/reason is required/i);
  });

  it("lets a manager change a member's role and records an audit entry", async () => {
    const { error } = await administratorClient.rpc("change_member_role", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_new_role: "treasurer",
      p_reason: "Promoting to treasurer for testing",
    });
    expect(error).toBeNull();

    const { data: row } = await ownerClient
      .from("group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", targetId)
      .single();
    expect(row?.role).toBe("treasurer");

    const { data: auditRows } = await ownerClient
      .from("audit_logs")
      .select("action, entity_id")
      .eq("group_id", groupId)
      .eq("action", "member_role_changed")
      .eq("entity_id", targetId);
    expect(auditRows?.length).toBeGreaterThan(0);
  });

  it("prevents a manager from changing their own role", async () => {
    // Must be a manager (targetClient at this point is an ordinary
    // member and would hit the "only owners and administrators" check
    // first) — this specifically exercises the self-change guard.
    const { error } = await administratorClient.rpc("change_member_role", {
      p_group_id: groupId,
      p_member_id: administratorId,
      p_new_role: "member",
      p_reason: "Trying to self-demote",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot change your own role/i);
  });

  it("prevents assigning the owner role directly, even via a raw RPC call", async () => {
    const { error } = await administratorClient.rpc("change_member_role", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_new_role: "owner",
      p_reason: "Trying to grant ownership directly",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/ownership transfer workflow/i);
  });

  it("prevents an administrator from changing, suspending, or removing the group owner", async () => {
    const roleChange = await administratorClient.rpc("change_member_role", {
      p_group_id: groupId,
      p_member_id: ownerId,
      p_new_role: "member",
      p_reason: "Trying to demote the owner",
    });
    expect(roleChange.error).not.toBeNull();
    expect(roleChange.error?.message).toMatch(/ownership transfer workflow/i);

    const suspend = await administratorClient.rpc("suspend_member", {
      p_group_id: groupId,
      p_member_id: ownerId,
      p_reason: "Trying to suspend the owner",
    });
    expect(suspend.error).not.toBeNull();
    expect(suspend.error?.message).toMatch(/owner cannot be suspended/i);

    const remove = await administratorClient.rpc("remove_member", {
      p_group_id: groupId,
      p_member_id: ownerId,
      p_reason: "Trying to remove the owner",
    });
    expect(remove.error).not.toBeNull();
    expect(remove.error?.message).toMatch(/owner cannot be removed/i);
  });

  it("prevents an ordinary member from managing other members", async () => {
    const { error } = await targetClient.rpc("suspend_member", {
      p_group_id: groupId,
      p_member_id: loanMemberId,
      p_reason: "Not authorised to do this",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only owners and administrators/i);
  });

  it("suspends a member, immediately revoking their read access, then reactivates them", async () => {
    const suspend = await administratorClient.rpc("suspend_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: "Testing suspension",
    });
    expect(suspend.error).toBeNull();

    const { data: statusRow } = await ownerClient
      .from("group_memberships")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", targetId)
      .single();
    expect(statusRow?.status).toBe("suspended");

    // A suspended member loses read access too, not just write — the
    // is_group_member() helper every RLS read policy relies on filters
    // on status = 'active'.
    const { data: seenAsSuspended } = await targetClient.from("groups").select("id").eq("id", groupId);
    expect(seenAsSuspended ?? []).toEqual([]);

    const reactivate = await administratorClient.rpc("reactivate_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: null,
    });
    expect(reactivate.error).toBeNull();

    const { data: seenAfterReactivation } = await targetClient.from("groups").select("id").eq("id", groupId);
    expect(seenAfterReactivation?.length).toBe(1);
  });

  it("suspension is scoped to one group only", async () => {
    const { data: invite } = await otherOwnerClient.rpc("create_invitation", {
      p_group_id: otherGroupId,
      p_email: loanMemberEmail,
      p_role: "member",
    });
    await loanMemberClient.rpc("accept_invitation", { p_token: invite![0].raw_token });

    // loanMember has no obligations in otherGroupId, so this suspension
    // (in groupId) should not touch their membership there.
    const suspend = await ownerClient.rpc("suspend_member", {
      p_group_id: groupId,
      p_member_id: loanMemberId,
      p_reason: "Scoping test — has an active loan, but suspension doesn't require removal-style checks",
    });
    expect(suspend.error).toBeNull();

    const { data: otherGroupMembership } = await adminClient
      .from("group_memberships")
      .select("status")
      .eq("group_id", otherGroupId)
      .eq("user_id", loanMemberId)
      .single();
    expect(otherGroupMembership?.status).toBe("active");

    // Reactivate so later tests see loanMember as active again.
    await ownerClient.rpc("reactivate_member", { p_group_id: groupId, p_member_id: loanMemberId, p_reason: null });
  });

  it("blocks removal while the member has an active loan, and explains why", async () => {
    const { error } = await ownerClient.rpc("remove_member", {
      p_group_id: groupId,
      p_member_id: loanMemberId,
      p_reason: "Trying to remove a member with an active loan",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/an active loan/i);
  });

  it("removes a member with no outstanding obligations, preserving their history", async () => {
    const { error } = await administratorClient.rpc("remove_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: "No longer participating",
    });
    expect(error).toBeNull();

    const { data: row } = await ownerClient
      .from("group_memberships")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", targetId)
      .single();
    expect(row?.status).toBe("removed");

    const { data: auditRows } = await ownerClient
      .from("audit_logs")
      .select("action")
      .eq("group_id", groupId)
      .eq("action", "member_removed")
      .eq("entity_id", targetId);
    expect(auditRows?.length).toBeGreaterThan(0);
  });

  // PA-13 regression: profiles_select_managers_any_status
  // (0027_fix_removed_member_profile_visibility.sql). Requires that
  // migration to be applied — see tests/security/README.md.
  it("lets an owner/administrator read a removed member's profile (Removed-tab identity fix)", async () => {
    const { data, error } = await ownerClient
      .from("profiles")
      .select("id, full_name")
      .eq("id", targetId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.full_name).toBe("Membership Test Target");
  });

  it("does not let a manager of an unrelated group read a removed member's profile", async () => {
    const { data, error } = await otherOwnerClient
      .from("profiles")
      .select("id, full_name")
      .eq("id", targetId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("does not let an ordinary member read a removed member's profile via the manager policy", async () => {
    const { data, error } = await loanMemberClient
      .from("profiles")
      .select("id, full_name")
      .eq("id", targetId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("prevents an ordinary member from reactivating a removed member", async () => {
    const { error } = await loanMemberClient.rpc("reactivate_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only owners and administrators/i);
  });

  it("does not let a manager of another group reactivate this group's member", async () => {
    const { error } = await otherOwnerClient.rpc("reactivate_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: null,
    });
    expect(error).not.toBeNull();
  });

  it("lets a manager directly reactivate a removed member, resetting their tenure", async () => {
    const { data: beforeRow } = await ownerClient
      .from("group_memberships")
      .select("joined_at")
      .eq("group_id", groupId)
      .eq("user_id", targetId)
      .single();
    const originalJoinedAt = beforeRow?.joined_at;

    const { error } = await administratorClient.rpc("reactivate_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: "Rejoining after a break",
    });
    expect(error).toBeNull();

    const { data: row } = await ownerClient
      .from("group_memberships")
      .select("status, joined_at")
      .eq("group_id", groupId)
      .eq("user_id", targetId)
      .single();
    expect(row?.status).toBe("active");
    // A removed member's tenure genuinely restarts — unlike suspension,
    // which only pauses — so joined_at must move forward, not stay
    // anchored to their original (now stale) join date.
    expect(new Date(row!.joined_at).getTime()).toBeGreaterThan(new Date(originalJoinedAt).getTime());

    const { data: seenAfterReactivation } = await targetClient.from("groups").select("id").eq("id", groupId);
    expect(seenAfterReactivation?.length).toBe(1);
  });

  it("does not modify a member's contribution history across a removal/reactivation cycle", async () => {
    const { data: planRow } = await ownerClient
      .from("contribution_plans")
      .select("id")
      .eq("group_id", groupId)
      .eq("status", "active")
      .single();

    const { data: contribution } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_contribution_plan_id: planRow!.id,
      p_amount_minor_units: 10000,
      p_period_start: "2026-03-01",
      p_period_end: "2026-03-31",
      p_received_at: "2026-03-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    const recordId = contribution![0].record_id;
    await ownerClient.rpc("verify_contribution", { p_record_id: recordId });

    const { data: before } = await ownerClient
      .from("contribution_records")
      .select("*")
      .eq("id", recordId)
      .single();

    await administratorClient.rpc("remove_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: "Testing contribution preservation across removal",
    });
    await administratorClient.rpc("reactivate_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: null,
    });

    const { data: after } = await ownerClient
      .from("contribution_records")
      .select("*")
      .eq("id", recordId)
      .single();

    expect(after).toEqual(before);
  });

  it("lets a removed member rejoin via a fresh invitation, instead of being blocked as 'already a member'", async () => {
    const { error: removeError } = await administratorClient.rpc("remove_member", {
      p_group_id: groupId,
      p_member_id: targetId,
      p_reason: "Testing the re-invitation path",
    });
    expect(removeError).toBeNull();

    const { data: invite, error: inviteError } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: targetEmail,
      p_role: "treasurer",
    });
    expect(inviteError).toBeNull();

    const { error: acceptError } = await targetClient.rpc("accept_invitation", {
      p_token: invite![0].raw_token,
    });
    expect(acceptError).toBeNull();

    const { data: rows } = await ownerClient
      .from("group_memberships")
      .select("status, role")
      .eq("group_id", groupId)
      .eq("user_id", targetId);
    // Exactly one row — the old 'removed' row was reactivated in place,
    // not left behind alongside a second inserted row (which would
    // violate the unique (group_id, user_id) constraint anyway).
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("active");
    expect(rows![0].role).toBe("treasurer");

    const { data: seenAfterRejoin } = await targetClient.from("groups").select("id").eq("id", groupId);
    expect(seenAfterRejoin?.length).toBe(1);
  });

  it("prevents an owner from removing themselves — they must use leave group", async () => {
    const { error } = await ownerClient.rpc("remove_member", {
      p_group_id: groupId,
      p_member_id: ownerId,
      p_reason: "Trying to self-remove",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/leave group option instead/i);
  });

  it("prevents the last active owner from leaving the group", async () => {
    const { error } = await ownerClient.rpc("leave_group", {
      p_group_id: groupId,
      p_reason: "Trying to leave as the only owner",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only owner of this group/i);
  });

  it("prevents a non-owner from initiating an ownership transfer", async () => {
    const { error } = await administratorClient.rpc("initiate_ownership_transfer", {
      p_group_id: groupId,
      p_to_user_id: loanMemberId,
      p_reason: "Not the owner",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only the group owner/i);
  });

  it("runs a full ownership transfer: initiate, block a second pending transfer, then accept", async () => {
    const { data: transfer, error: initiateError } = await ownerClient.rpc("initiate_ownership_transfer", {
      p_group_id: groupId,
      p_to_user_id: loanMemberId,
      p_reason: "Handing over ownership",
    });
    expect(initiateError).toBeNull();
    const transferId = transfer![0].transfer_id;

    const second = await ownerClient.rpc("initiate_ownership_transfer", {
      p_group_id: groupId,
      p_to_user_id: administratorId,
      p_reason: "Should be blocked — one already pending",
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.message).toMatch(/already has a pending ownership transfer/i);

    const wrongAccepter = await administratorClient.rpc("accept_ownership_transfer", {
      p_transfer_id: transferId,
    });
    expect(wrongAccepter.error).not.toBeNull();
    expect(wrongAccepter.error?.message).toMatch(/only the intended recipient/i);

    const { error: acceptError } = await loanMemberClient.rpc("accept_ownership_transfer", {
      p_transfer_id: transferId,
    });
    expect(acceptError).toBeNull();

    const { data: newOwnerRow } = await adminClient
      .from("group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", loanMemberId)
      .single();
    expect(newOwnerRow?.role).toBe("owner");

    const { data: formerOwnerRow } = await adminClient
      .from("group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", ownerId)
      .single();
    expect(formerOwnerRow?.role).toBe("administrator");

    // The former owner retains full authority as an administrator —
    // demonstrated by using it below to hand a second transfer through
    // decline/cancel, since loanMember is now the group's owner.
  });

  it("lets the transfer recipient decline, and lets the current owner cancel", async () => {
    const { data: declineTransfer } = await loanMemberClient.rpc("initiate_ownership_transfer", {
      p_group_id: groupId,
      p_to_user_id: administratorId,
      p_reason: "Offering ownership to be declined",
    });
    const declineId = declineTransfer![0].transfer_id;

    const { error: declineError } = await administratorClient.rpc("decline_ownership_transfer", {
      p_transfer_id: declineId,
      p_reason: "Not ready for this",
    });
    expect(declineError).toBeNull();

    const { data: declinedRow } = await adminClient
      .from("ownership_transfers")
      .select("status")
      .eq("id", declineId)
      .single();
    expect(declinedRow?.status).toBe("declined");

    const { data: cancelTransfer } = await loanMemberClient.rpc("initiate_ownership_transfer", {
      p_group_id: groupId,
      p_to_user_id: administratorId,
      p_reason: "Offering ownership to be cancelled",
    });
    const cancelId = cancelTransfer![0].transfer_id;

    const { error: cancelError } = await loanMemberClient.rpc("cancel_ownership_transfer", {
      p_transfer_id: cancelId,
      p_reason: "Changed my mind",
    });
    expect(cancelError).toBeNull();

    const { data: cancelledRow } = await adminClient
      .from("ownership_transfers")
      .select("status")
      .eq("id", cancelId)
      .single();
    expect(cancelledRow?.status).toBe("cancelled");
  });

  it("does not let a manager of another group manage this group's members", async () => {
    const { error } = await otherOwnerClient.rpc("suspend_member", {
      p_group_id: groupId,
      p_member_id: administratorId,
      p_reason: "Cross-group isolation check",
    });
    expect(error).not.toBeNull();
  });
});
