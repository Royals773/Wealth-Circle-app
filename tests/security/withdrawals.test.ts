/**
 * Live RLS and RPC tests for the Phase 6 withdrawal ledger.
 *
 * Same shape and setup as tests/security/loans.test.ts: runs against the
 * real Supabase project in .env.local, skipped (not failed) when the
 * required env vars aren't present. Requires
 * supabase/migrations/0011_phase6_withdrawals_governance.sql to already
 * be applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateTestPassword } from "./test-fixtures";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-withdraw-test-owner-${runId}@example.com`;
const adminEmail = `wc-withdraw-test-admin-${runId}@example.com`;
const memberEmail = `wc-withdraw-test-member-${runId}@example.com`;
const otherOwnerEmail = `wc-withdraw-test-other-${runId}@example.com`;
const testPassword = generateTestPassword();

describe.skipIf(!isConfigured)("withdrawal ledger (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let administratorClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let administratorId: string;
  let memberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;
  let memberRequestId: string;
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

    const owner = await createConfirmedUser(ownerEmail, "Withdraw Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const administrator = await createConfirmedUser(adminEmail, "Withdraw Test Administrator");
    administratorId = administrator.id;
    administratorClient = administrator.client;

    const member = await createConfirmedUser(memberEmail, "Withdraw Test Member");
    memberId = member.id;
    memberClient = member.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Withdraw Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    await adminClient.from("organiser_applications").insert({ user_id: ownerId, status: "approved" });
    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Withdrawal Test Group",
      p_slug: `withdraw-test-group-${runId}`,
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
      p_name: "Withdrawal Test Other Group",
      p_slug: `withdraw-test-other-group-${runId}`,
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

    const { data: adminInvite } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: adminEmail,
      p_role: "administrator",
    });
    await administratorClient.rpc("accept_invitation", { p_token: adminInvite![0].raw_token });

    const { data: memberInvite } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: memberEmail,
      p_role: "member",
    });
    await memberClient.rpc("accept_invitation", { p_token: memberInvite![0].raw_token });

    // Give the member and the owner verified contributions to withdraw against.
    const { data: plan } = await ownerClient.rpc("upsert_contribution_plan", {
      p_group_id: groupId,
      p_plan_id: null,
      p_is_flexible: false,
      p_amount_minor_units: 10000,
      p_minimum_amount_minor_units: null,
      p_frequency: "monthly",
      p_start_date: "2026-01-01",
    });

    async function giveVerifiedContribution(memberIdToCredit: string, amount: number) {
      const { data } = await ownerClient.rpc("record_contribution", {
        p_group_id: groupId,
        p_member_id: memberIdToCredit,
        p_contribution_plan_id: plan![0].plan_id,
        p_amount_minor_units: amount,
        p_period_start: "2026-01-01",
        p_period_end: "2026-01-31",
        p_received_at: "2026-01-15",
        p_payment_method: "cash",
        p_payment_reference: null,
        p_notes: null,
      });
      await ownerClient.rpc("verify_contribution", { p_record_id: data![0].record_id });
      await ownerClient.rpc("reconcile_contribution", { p_record_id: data![0].record_id });
    }

    await giveVerifiedContribution(memberId, 20000);
    await giveVerifiedContribution(ownerId, 20000);
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  it("does not let a member configure the withdrawal policy", async () => {
    const { error } = await memberClient.rpc("upsert_withdrawal_policy", {
      p_group_id: groupId,
      p_policy_id: null,
      p_enabled: true,
      p_min_amount_minor_units: null,
      p_max_amount_minor_units: null,
      p_notice_period_days: 0,
      p_allow_partial: true,
      p_reviewer_roles: ["owner", "administrator"],
      p_required_approvals: 2,
      p_allow_overdue_members: true,
      p_block_members_with_active_loans: false,
      p_large_withdrawal_threshold_minor_units: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only owners and administrators/i);
  });

  it("lets an owner configure a withdrawal policy requiring two approvals", async () => {
    const { data, error } = await ownerClient.rpc("upsert_withdrawal_policy", {
      p_group_id: groupId,
      p_policy_id: null,
      p_enabled: true,
      p_min_amount_minor_units: null,
      p_max_amount_minor_units: null,
      p_notice_period_days: 0,
      p_allow_partial: true,
      p_reviewer_roles: ["owner", "administrator"],
      p_required_approvals: 2,
      p_allow_overdue_members: true,
      p_block_members_with_active_loans: false,
      p_large_withdrawal_threshold_minor_units: null,
    });
    expect(error).toBeNull();
    expect(data![0].policy_id).toBeTruthy();
  });

  it("does not let a member request a withdrawal exceeding their verified balance", async () => {
    const { error } = await memberClient.rpc("request_withdrawal", {
      p_group_id: groupId,
      p_amount_minor_units: 999999,
      p_reason: "Too much",
      p_linked_proposal_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/exceeds your available balance/i);
  });

  it("lets a member request a withdrawal within their available balance", async () => {
    const { data, error } = await memberClient.rpc("request_withdrawal", {
      p_group_id: groupId,
      p_amount_minor_units: 5000,
      p_reason: "Personal emergency",
      p_linked_proposal_id: null,
    });
    expect(error).toBeNull();
    memberRequestId = data![0].request_id;
    expect(memberRequestId).toBeTruthy();

    const { data: row } = await ownerClient
      .from("withdrawal_requests")
      .select("status")
      .eq("id", memberRequestId)
      .single();
    expect(row?.status).toBe("submitted");
  });

  it("blocks a duplicate open request from the same member", async () => {
    const { error } = await memberClient.rpc("request_withdrawal", {
      p_group_id: groupId,
      p_amount_minor_units: 1000,
      p_reason: "Second attempt",
      p_linked_proposal_id: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already have an open withdrawal request/i);
  });

  it("does not let a member review or decide on withdrawal requests", async () => {
    const review = await memberClient.rpc("review_withdrawal_request", { p_request_id: memberRequestId });
    expect(review.error?.message).toMatch(/not authorised to review/i);

    const decide = await memberClient.rpc("decide_withdrawal_request", {
      p_request_id: memberRequestId,
      p_decision: "approved",
      p_notes: null,
    });
    expect(decide.error?.message).toMatch(/not authorised to decide/i);
  });

  it("does not let an owner decide on their own withdrawal request", async () => {
    const { data: ownRequest } = await ownerClient.rpc("request_withdrawal", {
      p_group_id: groupId,
      p_amount_minor_units: 1000,
      p_reason: "Owner's own request",
      p_linked_proposal_id: null,
    });
    const ownRequestId = ownRequest![0].request_id;

    const { error } = await ownerClient.rpc("decide_withdrawal_request", {
      p_request_id: ownRequestId,
      p_decision: "approved",
      p_notes: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot decide on your own withdrawal request/i);

    // Clean up so it doesn't interfere with the one-open-request-per-member rule.
    await ownerClient.rpc("cancel_withdrawal_request", { p_request_id: ownRequestId });
  });

  it("records the owner's approval as one of two required, leaving the request under review", async () => {
    const { data, error } = await ownerClient.rpc("decide_withdrawal_request", {
      p_request_id: memberRequestId,
      p_decision: "approved",
      p_notes: "Looks fine",
    });
    expect(error).toBeNull();
    expect(data![0].new_status).toBe("under_review");
  });

  it("does not let the same officer supply a second required approval", async () => {
    const { error } = await ownerClient.rpc("decide_withdrawal_request", {
      p_request_id: memberRequestId,
      p_decision: "approved",
      p_notes: "Trying again",
    });
    expect(error).not.toBeNull();
  });

  it("does not let a non-reviewer confirm payment", async () => {
    const { error } = await memberClient.rpc("confirm_withdrawal_payment", {
      p_request_id: memberRequestId,
      p_paid_amount_minor_units: 5000,
      p_bank_reference: "REF-1",
      p_paid_at: "2026-01-20",
      p_note: null,
    });
    expect(error).not.toBeNull();
  });

  it("reaches full approval once a second officer decides, moving the request to awaiting payment", async () => {
    const { data, error } = await administratorClient.rpc("decide_withdrawal_request", {
      p_request_id: memberRequestId,
      p_decision: "approved",
      p_notes: "Confirmed",
    });
    expect(error).toBeNull();
    expect(data![0].new_status).toBe("awaiting_payment");
  });

  it("requires the paid amount to match the requested amount exactly", async () => {
    const { error } = await ownerClient.rpc("confirm_withdrawal_payment", {
      p_request_id: memberRequestId,
      p_paid_amount_minor_units: 4000,
      p_bank_reference: "REF-1",
      p_paid_at: "2026-01-20",
      p_note: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/must match the approved amount/i);
  });

  it("lets a reviewer confirm payment, moving the request to paid_externally", async () => {
    const { error } = await ownerClient.rpc("confirm_withdrawal_payment", {
      p_request_id: memberRequestId,
      p_paid_amount_minor_units: 5000,
      p_bank_reference: "REF-1",
      p_paid_at: "2026-01-20",
      p_note: "Bank transfer completed",
    });
    expect(error).toBeNull();

    const { data: row } = await ownerClient
      .from("withdrawal_requests")
      .select("status, paid_amount_minor_units, paid_bank_reference")
      .eq("id", memberRequestId)
      .single();
    expect(row?.status).toBe("paid_externally");
    expect(row?.paid_amount_minor_units).toBe(5000);
    expect(row?.paid_bank_reference).toBe("REF-1");
  });

  it("does not let a paid record's financial fields be edited directly, even by the owner", async () => {
    const { data, error } = await ownerClient
      .from("withdrawal_requests")
      .update({ amount_minor_units: 999999 })
      .eq("id", memberRequestId)
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot be edited directly/i);
  });

  it("reverses a paid withdrawal with a traceable reason, leaving the original amount untouched", async () => {
    const { error } = await ownerClient.rpc("reverse_withdrawal_payment", {
      p_request_id: memberRequestId,
      p_reason: "Recorded against the wrong member by mistake",
    });
    expect(error).toBeNull();

    const { data: row } = await ownerClient
      .from("withdrawal_requests")
      .select("status, amount_minor_units, reversal_reason")
      .eq("id", memberRequestId)
      .single();
    expect(row?.status).toBe("reversed");
    expect(row?.amount_minor_units).toBe(5000);
    expect(row?.reversal_reason).toMatch(/wrong member/i);
  });

  it("does not let a manager of another group see, request or decide on withdrawals in this group", async () => {
    const { data: seen } = await otherOwnerClient.from("withdrawal_requests").select("id").eq("group_id", groupId);
    expect(seen).toEqual([]);

    const request = await otherOwnerClient.rpc("request_withdrawal", {
      p_group_id: groupId,
      p_amount_minor_units: 1000,
      p_reason: "Cross-group attempt",
      p_linked_proposal_id: null,
    });
    expect(request.error).not.toBeNull();

    const decide = await otherOwnerClient.rpc("decide_withdrawal_request", {
      p_request_id: memberRequestId,
      p_decision: "approved",
      p_notes: null,
    });
    expect(decide.error).not.toBeNull();
  });
});
