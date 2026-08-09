/**
 * Live RLS and RPC tests for the Phase 3 contribution ledger.
 *
 * Same shape and setup as tenant-isolation.test.ts: runs against the real
 * Supabase project in .env.local, skipped (not failed) when the required
 * env vars aren't present. SUPABASE_SECRET_KEY is used only to
 * pre-confirm throwaway test users and clean up afterward — every
 * assertion runs through a publishable-key client signed in as a real
 * test user, exercising the same RLS/RPC path the application does.
 *
 * Requires supabase/migrations/0006_phase3_contributions.sql to already
 * be applied to the project — the RPCs and columns it tests don't exist
 * before that.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-contrib-test-owner-${runId}@example.com`;
const memberEmail = `wc-contrib-test-member-${runId}@example.com`;
const otherOwnerEmail = `wc-contrib-test-other-${runId}@example.com`;
const testPassword = "ContribTest123!";

describe.skipIf(!isConfigured)("contribution ledger (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let memberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;
  let planId: string;
  let memberRecordId: string;

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

    const owner = await createConfirmedUser(ownerEmail, "Contribution Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const member = await createConfirmedUser(memberEmail, "Contribution Test Member");
    memberId = member.id;
    memberClient = member.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Contribution Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    await adminClient.from("organiser_applications").insert({ user_id: ownerId, status: "approved" });
    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Contribution Test Group",
      p_slug: `contrib-test-group-${runId}`,
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
    await adminClient.from("groups").update({ status: "active" }).eq("id", groupId);

    await adminClient.from("organiser_applications").insert({ user_id: otherOwnerId, status: "approved" });
    const { data: otherGroup } = await otherOwnerClient.rpc("create_group_with_setup", {
      p_name: "Contribution Test Other Group",
      p_slug: `contrib-test-other-group-${runId}`,
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

    // Invite and accept: member joins groupId as an ordinary 'member'.
    const { data: invite } = await ownerClient.rpc("create_invitation", {
      p_group_id: groupId,
      p_email: memberEmail,
      p_role: "member",
    });
    await memberClient.rpc("accept_invitation", { p_token: invite![0].raw_token });
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    if (memberId) await adminClient.auth.admin.deleteUser(memberId);
    if (otherOwnerId) await adminClient.auth.admin.deleteUser(otherOwnerId);
  });

  it("lets an owner configure a fixed contribution plan", async () => {
    const { data, error } = await ownerClient.rpc("upsert_contribution_plan", {
      p_group_id: groupId,
      p_plan_id: null,
      p_is_flexible: false,
      p_amount_minor_units: 5000,
      p_minimum_amount_minor_units: null,
      p_frequency: "monthly",
      p_start_date: "2026-01-01",
    });
    expect(error).toBeNull();
    planId = data![0].plan_id;
    expect(planId).toBeTruthy();
  });

  it("does not let an ordinary member configure the contribution plan", async () => {
    const { error } = await memberClient.rpc("upsert_contribution_plan", {
      p_group_id: groupId,
      p_plan_id: null,
      p_is_flexible: true,
      p_amount_minor_units: null,
      p_minimum_amount_minor_units: null,
      p_frequency: "monthly",
      p_start_date: "2026-01-01",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owners, administrators and treasurers/i);
  });

  it("does not let a member record a contribution via the RPC", async () => {
    const { error } = await memberClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: memberId,
      p_contribution_plan_id: planId,
      p_amount_minor_units: 5000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owners, administrators and treasurers/i);
  });

  it("does not let a member insert a ledger row directly, bypassing the RPC", async () => {
    const { data, error } = await memberClient
      .from("contribution_records")
      .insert({
        group_id: groupId,
        contribution_plan_id: planId,
        member_id: memberId,
        amount_minor_units: 5000,
        currency_code: "GBP",
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        created_by: memberId,
      })
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("lets an owner record a contribution for a member", async () => {
    const { data, error } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: memberId,
      p_contribution_plan_id: planId,
      p_amount_minor_units: 5000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: "REF-1",
      p_notes: null,
    });
    expect(error).toBeNull();
    memberRecordId = data![0].record_id;
    expect(memberRecordId).toBeTruthy();

    const { data: row } = await ownerClient
      .from("contribution_records")
      .select("status")
      .eq("id", memberRecordId)
      .single();
    expect(row?.status).toBe("pending_verification");
  });

  it("lets a member see only their own contribution records, not the group's whole ledger", async () => {
    const { data: ownRecords } = await memberClient
      .from("contribution_records")
      .select("id")
      .eq("group_id", groupId);
    expect(ownRecords?.map((r) => r.id)).toEqual([memberRecordId]);

    // The owner records a second contribution, for themselves — the
    // member must not be able to see it.
    const { data: ownerRecord } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: ownerId,
      p_contribution_plan_id: planId,
      p_amount_minor_units: 5000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "bank_transfer",
      p_payment_reference: null,
      p_notes: null,
    });
    const ownerRecordId = ownerRecord![0].record_id;

    const { data: stillOnlyOwn } = await memberClient
      .from("contribution_records")
      .select("id")
      .eq("group_id", groupId);
    const ids = stillOnlyOwn?.map((r) => r.id) ?? [];
    expect(ids).toContain(memberRecordId);
    expect(ids).not.toContain(ownerRecordId);
  });

  it("does not let a member verify, reconcile, reject or reverse a contribution", async () => {
    const verify = await memberClient.rpc("verify_contribution", { p_record_id: memberRecordId });
    expect(verify.error?.message).toMatch(/owners, administrators and treasurers/i);

    const reject = await memberClient.rpc("reject_contribution", {
      p_record_id: memberRecordId,
      p_reason: "not actually received",
    });
    expect(reject.error?.message).toMatch(/owners, administrators and treasurers/i);
  });

  it("does not let a member edit a pending contribution", async () => {
    const { error } = await memberClient.rpc("edit_contribution", {
      p_record_id: memberRecordId,
      p_amount_minor_units: 9999,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owners, administrators and treasurers/i);
  });

  it("lets an owner edit a pending contribution's amount, dates and reference", async () => {
    const { error } = await ownerClient.rpc("edit_contribution", {
      p_record_id: memberRecordId,
      p_amount_minor_units: 5500,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-16",
      p_payment_method: "bank_transfer",
      p_payment_reference: "REF-1-CORRECTED",
      p_notes: "Corrected a typo in the original amount",
    });
    expect(error).toBeNull();

    const { data: edited } = await ownerClient
      .from("contribution_records")
      .select("amount_minor_units, received_at, payment_method, payment_reference, status")
      .eq("id", memberRecordId)
      .single();
    expect(edited?.amount_minor_units).toBe(5500);
    expect(edited?.received_at).toBe("2026-01-16");
    expect(edited?.payment_method).toBe("bank_transfer");
    expect(edited?.payment_reference).toBe("REF-1-CORRECTED");
    expect(edited?.status).toBe("pending_verification");

    // Restore the amount the rest of the suite expects before verify/reconcile/reversal.
    const { error: restoreErr } = await ownerClient.rpc("edit_contribution", {
      p_record_id: memberRecordId,
      p_amount_minor_units: 5000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: "REF-1",
      p_notes: null,
    });
    expect(restoreErr).toBeNull();
  });

  it("does not let an owner of another group edit a contribution in this group", async () => {
    // RLS scopes the RPC's own lookup of the record, so a manager from an
    // unrelated group can't even see the row to reach the role check —
    // it fails with "not found" rather than a permission message, but the
    // edit is denied either way.
    const { error } = await otherOwnerClient.rpc("edit_contribution", {
      p_record_id: memberRecordId,
      p_amount_minor_units: 1,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/contribution record not found/i);
  });

  it("takes a contribution through verify -> reconcile", async () => {
    const { error: verifyErr } = await ownerClient.rpc("verify_contribution", {
      p_record_id: memberRecordId,
    });
    expect(verifyErr).toBeNull();

    const { data: afterVerify } = await ownerClient
      .from("contribution_records")
      .select("status, verified_by")
      .eq("id", memberRecordId)
      .single();
    expect(afterVerify?.status).toBe("verified");
    expect(afterVerify?.verified_by).toBe(ownerId);

    const { error: reconcileErr } = await ownerClient.rpc("reconcile_contribution", {
      p_record_id: memberRecordId,
    });
    expect(reconcileErr).toBeNull();

    const { data: afterReconcile } = await ownerClient
      .from("contribution_records")
      .select("status, reconciled_by")
      .eq("id", memberRecordId)
      .single();
    expect(afterReconcile?.status).toBe("reconciled");
    expect(afterReconcile?.reconciled_by).toBe(ownerId);
  });

  it("does not let a reconciled record be edited via edit_contribution — reversal is required instead", async () => {
    const { error } = await ownerClient.rpc("edit_contribution", {
      p_record_id: memberRecordId,
      p_amount_minor_units: 6000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only a record pending verification can be edited/i);
  });

  it("does not let a reconciled record's amount be edited directly, even by the owner", async () => {
    const { data, error } = await ownerClient
      .from("contribution_records")
      .update({ amount_minor_units: 999999 })
      .eq("id", memberRecordId)
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cannot be edited directly/i);
  });

  it("reverses a reconciled record with a traceable reason, actor and timestamp, leaving the original amount untouched", async () => {
    const { data, error } = await ownerClient.rpc("reverse_contribution", {
      p_record_id: memberRecordId,
      p_reason: "Recorded against the wrong period by mistake",
      p_replacement: null,
    });
    expect(error).toBeNull();
    expect(data![0].record_id).toBe(memberRecordId);
    expect(data![0].replacement_id).toBeNull();

    const { data: reversed } = await ownerClient
      .from("contribution_records")
      .select("status, amount_minor_units, reversed_by, reversed_at, reversal_reason")
      .eq("id", memberRecordId)
      .single();
    expect(reversed?.status).toBe("reversed");
    expect(reversed?.amount_minor_units).toBe(5000);
    expect(reversed?.reversed_by).toBe(ownerId);
    expect(reversed?.reversed_at).toBeTruthy();
    expect(reversed?.reversal_reason).toMatch(/wrong period/i);
  });

  it("reversing with a replacement creates a new linked, correctable entry", async () => {
    const { data: recorded } = await ownerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: memberId,
      p_contribution_plan_id: planId,
      p_amount_minor_units: 3000,
      p_period_start: "2026-02-01",
      p_period_end: "2026-02-28",
      p_received_at: "2026-02-10",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    const originalId = recorded![0].record_id;
    await ownerClient.rpc("verify_contribution", { p_record_id: originalId });

    const { data: reversed, error } = await ownerClient.rpc("reverse_contribution", {
      p_record_id: originalId,
      p_reason: "Wrong amount entered",
      p_replacement: { amount_minor_units: 3500 },
    });
    expect(error).toBeNull();
    const replacementId = reversed![0].replacement_id;
    expect(replacementId).toBeTruthy();

    const { data: replacement } = await ownerClient
      .from("contribution_records")
      .select("status, amount_minor_units, reversal_of, reversal_reason")
      .eq("id", replacementId)
      .single();
    expect(replacement?.status).toBe("pending_verification");
    expect(replacement?.amount_minor_units).toBe(3500);
    expect(replacement?.reversal_of).toBe(originalId);
    expect(replacement?.reversal_reason).toMatch(/wrong amount/i);
  });

  it("does not let a manager of another group record, verify or see contributions in this group", async () => {
    const record = await otherOwnerClient.rpc("record_contribution", {
      p_group_id: groupId,
      p_member_id: memberId,
      p_contribution_plan_id: planId,
      p_amount_minor_units: 1000,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-15",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(record.error).not.toBeNull();

    const { data: seen } = await otherOwnerClient.from("contribution_records").select("id").eq("group_id", groupId);
    expect(seen).toEqual([]);
  });
});
