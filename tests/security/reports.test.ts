/**
 * Live RLS tests for the Phase 8 reporting layer.
 *
 * Reports are computed live from existing RLS-scoped tables (no new
 * report-specific tables exist), so the real security boundary here is
 * exactly the same RLS this suite already exercises elsewhere —
 * these tests specifically validate the guarantees the report loaders
 * (src/lib/data/reports-summary.ts) depend on, including the real gap
 * found and fixed during this phase: contribution_records' RLS (Phase 3)
 * was never extended to loan_officer, so the "group financial overview"
 * page gates that role out rather than showing a silently-incomplete
 * total.
 *
 * Same shape and setup as tests/security/notifications.test.ts. Skipped
 * (not failed) when Supabase env vars aren't present.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-report-test-owner-${runId}@example.com`;
const treasurerEmail = `wc-report-test-treasurer-${runId}@example.com`;
const loanOfficerEmail = `wc-report-test-loanofficer-${runId}@example.com`;
const memberEmail = `wc-report-test-member-${runId}@example.com`;
const otherOwnerEmail = `wc-report-test-other-${runId}@example.com`;
const testPassword = "ReportTest123!";

describe.skipIf(!isConfigured)("reports (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let treasurerClient: SupabaseClient;
  let loanOfficerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let treasurerId: string;
  let loanOfficerId: string;
  let memberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;
  let contributionRecordId: string;

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

    const owner = await createConfirmedUser(ownerEmail, "Report Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const treasurer = await createConfirmedUser(treasurerEmail, "Report Test Treasurer");
    treasurerId = treasurer.id;
    treasurerClient = treasurer.client;

    const loanOfficer = await createConfirmedUser(loanOfficerEmail, "Report Test Loan Officer");
    loanOfficerId = loanOfficer.id;
    loanOfficerClient = loanOfficer.client;

    const member = await createConfirmedUser(memberEmail, "Report Test Member");
    memberId = member.id;
    memberClient = member.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Report Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Report Test Group",
      p_slug: `report-test-group-${runId}`,
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
      p_name: "Report Test Other Group",
      p_slug: `report-test-other-group-${runId}`,
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

    async function invite(email: string, role: string) {
      const { data } = await ownerClient.rpc("create_invitation", { p_group_id: groupId, p_email: email, p_role: role });
      return data![0].raw_token as string;
    }

    await treasurerClient.rpc("accept_invitation", { p_token: await invite(treasurerEmail, "treasurer") });
    await loanOfficerClient.rpc("accept_invitation", { p_token: await invite(loanOfficerEmail, "loan_officer") });
    await memberClient.rpc("accept_invitation", { p_token: await invite(memberEmail, "member") });

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
      p_member_id: memberId,
      p_contribution_plan_id: plan![0].plan_id,
      p_amount_minor_units: 10000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    contributionRecordId = contribution![0].record_id;
    await ownerClient.rpc("verify_contribution", { p_record_id: contributionRecordId });
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    if (treasurerId) await adminClient.auth.admin.deleteUser(treasurerId);
    if (loanOfficerId) await adminClient.auth.admin.deleteUser(loanOfficerId);
    if (memberId) await adminClient.auth.admin.deleteUser(memberId);
    if (otherOwnerId) await adminClient.auth.admin.deleteUser(otherOwnerId);
  });

  it("lets a treasurer (a full-visibility role) read every member's contribution records for the group", async () => {
    const { data } = await treasurerClient
      .from("contribution_records")
      .select("id")
      .eq("group_id", groupId);
    expect(data?.some((r) => r.id === contributionRecordId)).toBe(true);
  });

  it("does NOT let a loan officer read another member's contribution records — the exact gap the Reports page now gates around", async () => {
    const { data } = await loanOfficerClient
      .from("contribution_records")
      .select("id")
      .eq("group_id", groupId)
      .eq("id", contributionRecordId);
    expect(data ?? []).toEqual([]);
  });

  it("lets the member read only their own contribution record, matching what their statement is built from", async () => {
    const { data } = await memberClient.from("contribution_records").select("id").eq("group_id", groupId);
    expect(data?.map((r) => r.id)).toEqual([contributionRecordId]);
  });

  it("blocks cross-group reads even when the report code itself filters by group_id", async () => {
    // Simulates the exact query shape reports-summary.ts uses — RLS
    // must be the thing that blocks this, not just the group_id filter
    // the application code happens to pass.
    const { data: contributions } = await otherOwnerClient
      .from("contribution_records")
      .select("id")
      .eq("group_id", groupId);
    expect(contributions ?? []).toEqual([]);

    const { data: withdrawals } = await otherOwnerClient
      .from("withdrawal_requests")
      .select("id")
      .eq("group_id", groupId);
    expect(withdrawals ?? []).toEqual([]);

    const { data: repayments } = await otherOwnerClient
      .from("repayments")
      .select("id")
      .eq("group_id", groupId);
    expect(repayments ?? []).toEqual([]);
  });

  it("logs a report_export_generated audit entry visible to managers, not to a plain member", async () => {
    await adminClient.from("audit_logs").insert({
      group_id: groupId,
      actor_id: treasurerId,
      action: "report_export_generated",
      entity_type: "report",
      entity_id: null,
      metadata: { report_type: "financial_overview" },
    });

    const { data: asOwner } = await ownerClient
      .from("audit_logs")
      .select("id")
      .eq("group_id", groupId)
      .eq("action", "report_export_generated");
    expect(asOwner?.length).toBeGreaterThan(0);

    const { data: asMember } = await memberClient
      .from("audit_logs")
      .select("id")
      .eq("group_id", groupId)
      .eq("action", "report_export_generated");
    expect(asMember ?? []).toEqual([]);
  });

  it("a member_statement export audit entry carries which member it was for, distinguishable from who ran it (Phase 9 fix)", async () => {
    // Mirrors what the export route's streamCsv() now writes: an
    // officer (treasurer) exporting the member's statement should
    // produce a row whose actor_id is the officer but whose metadata
    // names the subject member — previously this was unrecoverable
    // from the audit log (metadata only ever held report_type).
    await adminClient.from("audit_logs").insert({
      group_id: groupId,
      actor_id: treasurerId,
      action: "report_export_generated",
      entity_type: "report",
      entity_id: null,
      metadata: {
        report_type: "member_statement",
        subject_member_id: memberId,
        subject_member_name: "Report Test Member",
      },
    });

    const { data } = await ownerClient
      .from("audit_logs")
      .select("actor_id, metadata")
      .eq("group_id", groupId)
      .eq("action", "report_export_generated")
      .eq("metadata->>report_type", "member_statement")
      .single();

    expect(data?.actor_id).toBe(treasurerId);
    expect(data?.metadata?.subject_member_id).toBe(memberId);
    expect(data?.actor_id).not.toBe(data?.metadata?.subject_member_id);
  });
});
