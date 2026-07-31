/**
 * Live RLS and RPC tests for the Phase 6 governance model.
 *
 * Same shape and setup as tests/security/withdrawals.test.ts: runs
 * against the real Supabase project in .env.local, skipped (not failed)
 * when the required env vars aren't present. Requires
 * supabase/migrations/0011_phase6_withdrawals_governance.sql to already
 * be applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-gov-test-owner-${runId}@example.com`;
const earlyMemberEmail = `wc-gov-test-early-${runId}@example.com`;
const lateMemberEmail = `wc-gov-test-late-${runId}@example.com`;
const otherOwnerEmail = `wc-gov-test-other-${runId}@example.com`;
const testPassword = "GovTest123!";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!isConfigured)("governance (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let earlyMemberClient: SupabaseClient;
  let lateMemberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let earlyMemberId: string;
  let lateMemberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;
  let earlyMemberJoinedAt: string;

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

    const owner = await createConfirmedUser(ownerEmail, "Governance Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const earlyMember = await createConfirmedUser(earlyMemberEmail, "Governance Test Early Member");
    earlyMemberId = earlyMember.id;
    earlyMemberClient = earlyMember.client;

    const lateMember = await createConfirmedUser(lateMemberEmail, "Governance Test Late Member");
    lateMemberId = lateMember.id;
    lateMemberClient = lateMember.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Governance Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Governance Test Group",
      p_slug: `gov-test-group-${runId}`,
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

    const { data: otherGroup } = await otherOwnerClient.rpc("create_group_with_setup", {
      p_name: "Governance Test Other Group",
      p_slug: `gov-test-other-group-${runId}`,
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

    const { data: earlyInvite } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: earlyMemberEmail,
      p_role: "member",
    });
    await earlyMemberClient.rpc("accept_invitation", { p_token: earlyInvite![0].raw_token });

    // Anchor future "voting already open" timestamps to the member's
    // actual server-recorded join instant, not this test runner's own
    // clock — the two Supabase services involved (Auth vs. Postgres/
    // PostgREST) were observed to disagree by more than a naive
    // Date.now()-based margin could safely absorb.
    const { data: earlyMembership } = await adminClient
      .from("group_memberships")
      .select("joined_at")
      .eq("group_id", groupId)
      .eq("user_id", earlyMemberId)
      .single();
    earlyMemberJoinedAt = earlyMembership!.joined_at;
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    if (earlyMemberId) await adminClient.auth.admin.deleteUser(earlyMemberId);
    if (lateMemberId) await adminClient.auth.admin.deleteUser(lateMemberId);
    if (otherOwnerId) await adminClient.auth.admin.deleteUser(otherOwnerId);
  });

  it("lets any member create a proposal", async () => {
    const opensAt = new Date(Date.now() + 1000).toISOString();
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const { data, error } = await earlyMemberClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Increase contribution amount",
      p_description: "Proposal to raise monthly contributions.",
      p_category: "Rule change",
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    expect(error).toBeNull();
    expect(data![0].proposal_id).toBeTruthy();
  });

  it("rejects a voting window that closes before it opens", async () => {
    const opensAt = new Date(Date.now() + 60_000).toISOString();
    const closesAt = new Date(Date.now() + 1000).toISOString();
    const { error } = await ownerClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Invalid window",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/close after it opens/i);
  });

  it("does not let a member vote before the voting window opens", async () => {
    const opensAt = new Date(Date.now() + 30_000).toISOString();
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const { data: proposal } = await ownerClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Not yet open",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });

    const { error } = await earlyMemberClient.rpc("cast_vote", {
      p_proposal_id: proposal![0].proposal_id,
      p_choice: "for",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/has not opened yet/i);
  });

  it("rejects a vote from a member who joined after voting opened", async () => {
    // Anchored to earlyMember's own recorded join instant (not this test
    // runner's clock), so eligibility (joined_at <= voting_opens_at) holds
    // exactly regardless of clock skew between Supabase services — and
    // real time has necessarily moved on since that join by now, so
    // voting is also already open.
    const opensAt = earlyMemberJoinedAt;
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const { data: proposal } = await ownerClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Eligibility test proposal",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    const proposalId = proposal![0].proposal_id;

    // The late member joins strictly after this proposal's voting_opens_at.
    const { data: lateInvite } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: lateMemberEmail,
      p_role: "member",
    });
    await lateMemberClient.rpc("accept_invitation", { p_token: lateInvite![0].raw_token });

    const eligibleVote = await earlyMemberClient.rpc("cast_vote", { p_proposal_id: proposalId, p_choice: "for" });
    expect(eligibleVote.error).toBeNull();

    const ineligibleVote = await lateMemberClient.rpc("cast_vote", { p_proposal_id: proposalId, p_choice: "for" });
    expect(ineligibleVote.error).not.toBeNull();
    expect(ineligibleVote.error?.message).toMatch(/eligible to vote/i);
  });

  it("does not let a member vote twice on the same proposal", async () => {
    // Anchored to earlyMember's own recorded join instant (not this test
    // runner's clock), so eligibility (joined_at <= voting_opens_at) holds
    // exactly regardless of clock skew between Supabase services — and
    // real time has necessarily moved on since that join by now, so
    // voting is also already open.
    const opensAt = earlyMemberJoinedAt;
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const { data: proposal } = await ownerClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "One vote per member",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    const proposalId = proposal![0].proposal_id;

    const first = await earlyMemberClient.rpc("cast_vote", { p_proposal_id: proposalId, p_choice: "for" });
    expect(first.error).toBeNull();

    const second = await earlyMemberClient.rpc("cast_vote", { p_proposal_id: proposalId, p_choice: "against" });
    expect(second.error).not.toBeNull();
    expect(second.error?.message).toMatch(/already voted/i);
  });

  it("closes voting at the configured instant and reveals the full result to everyone afterward", async () => {
    // Anchored to earlyMember's own recorded join instant (not this test
    // runner's clock), so eligibility (joined_at <= voting_opens_at) holds
    // exactly regardless of clock skew between Supabase services — and
    // real time has necessarily moved on since that join by now, so
    // voting is also already open.
    const opensAt = earlyMemberJoinedAt;
    const closesAt = new Date(Date.now() + 2000).toISOString();
    const { data: proposal } = await ownerClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Short voting window",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    const proposalId = proposal![0].proposal_id;

    const duringWindow = await earlyMemberClient.rpc("cast_vote", { p_proposal_id: proposalId, p_choice: "for" });
    expect(duringWindow.error).toBeNull();

    // Before close, an ordinary member of this same group (not the voter,
    // not a manager or auditor) should not see this vote row at all —
    // lateMember is a real member here, just not the one who voted.
    const { data: beforeClose } = await lateMemberClient
      .from("votes")
      .select("id")
      .eq("proposal_id", proposalId);
    expect(beforeClose ?? []).toEqual([]);

    await sleep(2500);

    const afterClose = await ownerClient.rpc("cast_vote", { p_proposal_id: proposalId, p_choice: "against" });
    expect(afterClose.error).not.toBeNull();
    expect(afterClose.error?.message).toMatch(/voting has closed/i);

    // After close, even a non-manager, non-voting member of the group can
    // see the full result — the visibility flip this policy is meant to test.
    const { data: afterCloseVotes } = await lateMemberClient
      .from("votes")
      .select("id, voter_id")
      .eq("proposal_id", proposalId);
    expect(afterCloseVotes?.length).toBe(1);
  });

  it("lets the proposer cancel their own proposal before voting opens, but not after", async () => {
    const opensAt = new Date(Date.now() + 60_000).toISOString();
    const closesAt = new Date(Date.now() + 120_000).toISOString();
    const { data: proposal } = await earlyMemberClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Withdraw before voting",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    const proposalId = proposal![0].proposal_id;

    const { error } = await earlyMemberClient.rpc("cancel_governance_proposal", {
      p_proposal_id: proposalId,
      p_reason: "No longer needed",
    });
    expect(error).toBeNull();

    const { data: row } = await ownerClient.from("governance_proposals").select("status").eq("id", proposalId).single();
    expect(row?.status).toBe("cancelled");
  });

  it("lets an owner cancel a proposal at any time, even after voting has opened", async () => {
    // Anchored to earlyMember's own recorded join instant (not this test
    // runner's clock), so eligibility (joined_at <= voting_opens_at) holds
    // exactly regardless of clock skew between Supabase services — and
    // real time has necessarily moved on since that join by now, so
    // voting is also already open.
    const opensAt = earlyMemberJoinedAt;
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const { data: proposal } = await earlyMemberClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Owner can cancel anytime",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    const proposalId = proposal![0].proposal_id;

    // The proposer themselves can no longer cancel once voting has opened.
    const selfCancel = await earlyMemberClient.rpc("cancel_governance_proposal", {
      p_proposal_id: proposalId,
      p_reason: "Trying after opening",
    });
    expect(selfCancel.error).not.toBeNull();

    const ownerCancel = await ownerClient.rpc("cancel_governance_proposal", {
      p_proposal_id: proposalId,
      p_reason: "Owner override",
    });
    expect(ownerCancel.error).toBeNull();
  });

  it("does not let a manager of another group see or vote on this group's proposals", async () => {
    // Anchored to earlyMember's own recorded join instant (not this test
    // runner's clock), so eligibility (joined_at <= voting_opens_at) holds
    // exactly regardless of clock skew between Supabase services — and
    // real time has necessarily moved on since that join by now, so
    // voting is also already open.
    const opensAt = earlyMemberJoinedAt;
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const { data: proposal } = await ownerClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Cross-group isolation check",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    const proposalId = proposal![0].proposal_id;

    const { data: seen } = await otherOwnerClient.from("governance_proposals").select("id").eq("id", proposalId);
    expect(seen).toEqual([]);

    const { error } = await otherOwnerClient.rpc("cast_vote", { p_proposal_id: proposalId, p_choice: "for" });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not found/i);
  });

  it("blocks approving a large withdrawal until its linked proposal has passed", async () => {
    await ownerClient.rpc("upsert_withdrawal_policy", {
      p_group_id: groupId,
      p_policy_id: null,
      p_enabled: true,
      p_min_amount_minor_units: null,
      p_max_amount_minor_units: null,
      p_notice_period_days: 0,
      p_allow_partial: true,
      p_reviewer_roles: ["owner"],
      p_required_approvals: 1,
      p_allow_overdue_members: true,
      p_block_members_with_active_loans: false,
      p_large_withdrawal_threshold_minor_units: 1000,
    });

    const { data: plan } = await ownerClient.rpc("upsert_contribution_plan", {
      p_group_id: groupId,
      p_plan_id: null,
      p_is_flexible: true,
      p_amount_minor_units: null,
      p_minimum_amount_minor_units: null,
      p_frequency: "monthly",
      p_start_date: "2026-01-01",
    });
    const { data: contribution } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: earlyMemberId,
      p_contribution_plan_id: plan![0].plan_id,
      p_amount_minor_units: 50000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    await ownerClient.rpc("verify_contribution", { p_record_id: contribution![0].record_id });
    await ownerClient.rpc("reconcile_contribution", { p_record_id: contribution![0].record_id });

    // Anchored to earlyMember's own recorded join instant (not this test
    // runner's clock), so eligibility (joined_at <= voting_opens_at) holds
    // exactly regardless of clock skew between Supabase services — and
    // real time has necessarily moved on since that join by now, so
    // voting is also already open.
    const opensAt = earlyMemberJoinedAt;
    const closesAt = new Date(Date.now() + 60_000).toISOString();
    const { data: proposal } = await ownerClient.rpc("create_governance_proposal", {
      p_group_id: groupId,
      p_title: "Approve a large withdrawal",
      p_description: null,
      p_category: null,
      p_voting_opens_at: opensAt,
      p_voting_closes_at: closesAt,
      p_quorum_percent: null,
      p_approval_threshold_percent: 50,
    });
    const proposalId = proposal![0].proposal_id;

    const { data: withdrawal, error: withdrawalError } = await earlyMemberClient.rpc("request_withdrawal", {
      p_group_id: groupId,
      p_amount_minor_units: 2000,
      p_reason: "Large withdrawal requiring a vote",
      p_linked_proposal_id: proposalId,
    });
    expect(withdrawalError).toBeNull();
    const withdrawalId = withdrawal![0].request_id;

    const { error: decideError } = await ownerClient.rpc("decide_withdrawal_request", {
      p_request_id: withdrawalId,
      p_decision: "approved",
      p_notes: null,
    });
    expect(decideError).not.toBeNull();
    expect(decideError?.message).toMatch(/linked governance proposal to pass/i);
  });
});
