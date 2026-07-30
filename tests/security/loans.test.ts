/**
 * Live RLS and RPC tests for the Phase 4 loan ledger.
 *
 * Same shape and setup as tests/security/contributions.test.ts: runs
 * against the real Supabase project in .env.local, skipped (not failed)
 * when the required env vars aren't present. Requires
 * supabase/migrations/0007_phase4_loans.sql to already be applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-loan-test-owner-${runId}@example.com`;
const memberEmail = `wc-loan-test-member-${runId}@example.com`;
const otherOwnerEmail = `wc-loan-test-other-${runId}@example.com`;
const testPassword = "LoanTest123!";

describe.skipIf(!isConfigured)("loan ledger (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let memberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;
  let memberApplicationId: string;
  let memberLoanId: string;
  let memberRepaymentId: string;

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

    const owner = await createConfirmedUser(ownerEmail, "Loan Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const member = await createConfirmedUser(memberEmail, "Loan Test Member");
    memberId = member.id;
    memberClient = member.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Loan Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Loan Test Group",
      p_slug: `loan-test-group-${runId}`,
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
      p_name: "Loan Test Other Group",
      p_slug: `loan-test-other-group-${runId}`,
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

    const { data: invite } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: memberEmail,
      p_role: "member",
    });
    await memberClient.rpc("accept_invitation", { p_token: invite![0].raw_token });

    // Give the member 100.00 GBP of verified contributions to borrow against.
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
    await ownerClient.rpc("verify_contribution", { p_record_id: contribution![0].record_id });
    await ownerClient.rpc("reconcile_contribution", { p_record_id: contribution![0].record_id });

    // The owner also needs some verified contributions of their own for
    // the self-approval test below (applying for a loan requires
    // borrowing capacity, independent of what's being tested there).
    const { data: ownerContribution } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: ownerId,
      p_contribution_plan_id: plan![0].plan_id,
      p_amount_minor_units: 2000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    await ownerClient.rpc("verify_contribution", { p_record_id: ownerContribution![0].record_id });
    await ownerClient.rpc("reconcile_contribution", { p_record_id: ownerContribution![0].record_id });
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    if (memberId) await adminClient.auth.admin.deleteUser(memberId);
    if (otherOwnerId) await adminClient.auth.admin.deleteUser(otherOwnerId);
  });

  it("lets an owner configure the loan policy", async () => {
    const { data, error } = await ownerClient.rpc("upsert_loan_product", {
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
    expect(error).toBeNull();
    expect(data![0].product_id).toBeTruthy();
  });

  it("does not let an ordinary member configure the loan policy", async () => {
    const { error } = await memberClient.rpc("upsert_loan_product", {
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
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owners, administrators and loan officers/i);
  });

  it("does not let a member borrow more than their eligibility limit, even via a direct RPC call", async () => {
    // Eligible for 95% of 100.00 = 95.00. Try to borrow 200.00.
    const { error } = await memberClient.rpc("apply_for_loan", {
      p_group_id: groupId,
      p_amount_minor_units: 20000,
      p_term_months: 6,
      p_purpose: "too much",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/exceeds your available borrowing limit/i);
  });

  it("lets an eligible member apply for a loan within their limit", async () => {
    const { data, error } = await memberClient.rpc("apply_for_loan", {
      p_group_id: groupId,
      p_amount_minor_units: 5000,
      p_term_months: 6,
      p_purpose: "test purpose",
    });
    expect(error).toBeNull();
    memberApplicationId = data![0].application_id;
    expect(memberApplicationId).toBeTruthy();

    const { data: row } = await ownerClient
      .from("loan_applications")
      .select("status")
      .eq("id", memberApplicationId)
      .single();
    expect(row?.status).toBe("submitted");
  });

  it("does not let the same member submit a second application while one is still open", async () => {
    const { error } = await memberClient.rpc("apply_for_loan", {
      p_group_id: groupId,
      p_amount_minor_units: 1000,
      p_term_months: 3,
      p_purpose: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already have an application/i);
  });

  it("lets a member see only their own application, not the group's whole queue", async () => {
    const { data } = await memberClient.from("loan_applications").select("id").eq("group_id", groupId);
    expect(data?.map((a) => a.id)).toEqual([memberApplicationId]);
  });

  it("does not let a member decide on their own application, via RPC or a direct table update", async () => {
    const rpcResult = await memberClient.rpc("decide_loan_application", {
      p_application_id: memberApplicationId,
      p_decision: "approved",
      p_approved_amount_minor_units: 5000,
      p_approved_term_months: 6,
      p_approved_interest_rate_bps: 500,
      p_approved_repayment_frequency: "monthly",
      p_notes: null,
    });
    expect(rpcResult.error).not.toBeNull();

    // The member IS the applicant, so the "cancel own" policy's USING
    // clause matches this row — but its WITH CHECK only permits
    // transitioning to 'cancelled', so attempting 'approved' here is a
    // real RLS violation (an error), not a silent zero-row no-op.
    const { data: directUpdate, error: directUpdateErr } = await memberClient
      .from("loan_applications")
      .update({ status: "approved" })
      .eq("id", memberApplicationId)
      .select();
    expect(directUpdate).toBeNull();
    expect(directUpdateErr).not.toBeNull();
  });

  it("does not let an owner approve their own application (self-approval prevention)", async () => {
    const { data: ownApplication, error: applyErr } = await ownerClient.rpc("apply_for_loan", {
      p_group_id: groupId,
      p_amount_minor_units: 1000,
      p_term_months: 3,
      p_purpose: "owner's own loan",
    });
    expect(applyErr).toBeNull();
    const ownApplicationId = ownApplication![0].application_id;

    const rpcResult = await ownerClient.rpc("decide_loan_application", {
      p_application_id: ownApplicationId,
      p_decision: "approved",
      p_approved_amount_minor_units: 1000,
      p_approved_term_months: 3,
      p_approved_interest_rate_bps: 500,
      p_approved_repayment_frequency: "monthly",
      p_notes: null,
    });
    expect(rpcResult.error).not.toBeNull();
    expect(rpcResult.error?.message).toMatch(/cannot decide on your own application/i);

    // Independently confirm the RLS layer alone (not just the RPC's
    // explicit check) would also block a direct update attempt — same
    // "USING matches, WITH CHECK rejects" shape as the member case above.
    const { data: directUpdate, error: directUpdateErr } = await ownerClient
      .from("loan_applications")
      .update({ status: "approved", approved_amount_minor_units: 1000 })
      .eq("id", ownApplicationId)
      .select();
    expect(directUpdate).toBeNull();
    expect(directUpdateErr).not.toBeNull();

    await ownerClient.rpc("cancel_loan_application", { p_application_id: ownApplicationId });
  });

  it("takes an application through review -> approval, creating a loan awaiting disbursement", async () => {
    const { error: reviewErr } = await ownerClient.rpc("mark_loan_under_review", {
      p_application_id: memberApplicationId,
    });
    expect(reviewErr).toBeNull();

    const { data: decision, error: decideErr } = await ownerClient.rpc("decide_loan_application", {
      p_application_id: memberApplicationId,
      p_decision: "approved",
      p_approved_amount_minor_units: 5000,
      p_approved_term_months: 6,
      p_approved_interest_rate_bps: 500,
      p_approved_repayment_frequency: "monthly",
      p_notes: "approved for testing",
    });
    expect(decideErr).toBeNull();
    memberLoanId = decision![0].loan_id;
    expect(memberLoanId).toBeTruthy();

    const { data: loan } = await ownerClient
      .from("loans")
      .select("status, total_repayable_minor_units, interest_amount_minor_units")
      .eq("id", memberLoanId)
      .single();
    expect(loan?.status).toBe("awaiting_disbursement");
    expect(loan?.interest_amount_minor_units).toBe(250); // 5000 * 5% = 250
    expect(loan?.total_repayable_minor_units).toBe(5250);
  });

  it("does not activate the loan until a disbursement is recorded", async () => {
    const { error: repaymentErr } = await ownerClient.rpc("record_repayment", {
      p_loan_id: memberLoanId,
      p_amount_minor_units: 100,
      p_received_at: "2026-02-01",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(repaymentErr).not.toBeNull();
    expect(repaymentErr?.message).toMatch(/active loan/i);
  });

  it("does not let a member record a disbursement", async () => {
    const { error } = await memberClient.rpc("record_disbursement", {
      p_loan_id: memberLoanId,
      p_disbursement_date: "2026-02-01",
      p_disbursement_reference: null,
      p_disbursement_note: null,
    });
    expect(error).not.toBeNull();
  });

  it("lets an officer record a disbursement, activating the loan", async () => {
    const { error } = await ownerClient.rpc("record_disbursement", {
      p_loan_id: memberLoanId,
      p_disbursement_date: "2026-02-01",
      p_disbursement_reference: "BANKREF-1",
      p_disbursement_note: null,
    });
    expect(error).toBeNull();

    const { data: loan } = await ownerClient.from("loans").select("status").eq("id", memberLoanId).single();
    expect(loan?.status).toBe("active");
  });

  it("does not let a member insert a repayment row directly, bypassing the RPC", async () => {
    const { data, error } = await memberClient
      .from("repayments")
      .insert({
        group_id: groupId,
        loan_id: memberLoanId,
        member_id: memberId,
        amount_minor_units: 1000,
        currency_code: "GBP",
        principal_portion_minor_units: 950,
        interest_portion_minor_units: 50,
        created_by: memberId,
      })
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("records a repayment with a proportional principal/interest split", async () => {
    const { data, error } = await ownerClient.rpc("record_repayment", {
      p_loan_id: memberLoanId,
      p_amount_minor_units: 1050,
      p_received_at: "2026-03-01",
      p_payment_method: "bank_transfer",
      p_payment_reference: "REF-1",
      p_notes: null,
    });
    expect(error).toBeNull();
    memberRepaymentId = data![0].repayment_id;

    const { data: row } = await ownerClient
      .from("repayments")
      .select("status, principal_portion_minor_units, interest_portion_minor_units")
      .eq("id", memberRepaymentId)
      .single();
    expect(row?.status).toBe("pending_verification");
    // 1050 * (5000/5250) = 1000 principal, 50 interest
    expect(row?.principal_portion_minor_units).toBe(1000);
    expect(row?.interest_portion_minor_units).toBe(50);
  });

  it("takes the repayment through verify -> reconcile", async () => {
    const { error: verifyErr } = await ownerClient.rpc("verify_repayment", { p_repayment_id: memberRepaymentId });
    expect(verifyErr).toBeNull();

    const { error: reconcileErr } = await ownerClient.rpc("reconcile_repayment", {
      p_repayment_id: memberRepaymentId,
    });
    expect(reconcileErr).toBeNull();

    const { data: row } = await ownerClient
      .from("repayments")
      .select("status, reconciled_by")
      .eq("id", memberRepaymentId)
      .single();
    expect(row?.status).toBe("reconciled");
    expect(row?.reconciled_by).toBe(ownerId);
  });

  it("does not let a reconciled repayment's amount be edited directly", async () => {
    const { data, error } = await ownerClient
      .from("repayments")
      .update({ amount_minor_units: 999999 })
      .eq("id", memberRepaymentId)
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot be edited directly/i);
  });

  it("reverses a reconciled repayment with a traceable reason, actor and timestamp", async () => {
    const { data, error } = await ownerClient.rpc("reverse_repayment", {
      p_repayment_id: memberRepaymentId,
      p_reason: "Recorded against the wrong loan by mistake",
      p_replacement: null,
    });
    expect(error).toBeNull();
    expect(data![0].repayment_id).toBe(memberRepaymentId);

    const { data: row } = await ownerClient
      .from("repayments")
      .select("status, amount_minor_units, reversed_by, reversed_at, reversal_reason")
      .eq("id", memberRepaymentId)
      .single();
    expect(row?.status).toBe("reversed");
    expect(row?.amount_minor_units).toBe(1050);
    expect(row?.reversed_by).toBe(ownerId);
    expect(row?.reversal_reason).toMatch(/wrong loan/i);
  });

  it("does not let a manager of another group see, approve or disburse loans in this group", async () => {
    const { data: seenApplications } = await otherOwnerClient
      .from("loan_applications")
      .select("id")
      .eq("group_id", groupId);
    expect(seenApplications).toEqual([]);

    const { data: seenLoans } = await otherOwnerClient.from("loans").select("id").eq("group_id", groupId);
    expect(seenLoans).toEqual([]);

    const disburseResult = await otherOwnerClient.rpc("record_disbursement", {
      p_loan_id: memberLoanId,
      p_disbursement_date: "2026-02-01",
      p_disbursement_reference: null,
      p_disbursement_note: null,
    });
    expect(disburseResult.error).not.toBeNull();
  });
});
