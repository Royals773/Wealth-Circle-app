/**
 * Live RLS and RPC tests for back-dated/historical contribution import.
 *
 * Same shape and setup as tests/security/membership.test.ts: runs
 * against the real Supabase project configured in the environment,
 * skipped (not failed) when the required env vars aren't present.
 * Requires supabase/migrations/0023_backdated_contribution_import.sql
 * to already be applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateTestPassword } from "./test-fixtures";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerAEmail = `wc-backdate-test-ownera-${runId}@example.com`;
const memberAEmail = `wc-backdate-test-membera-${runId}@example.com`;
const member2AEmail = `wc-backdate-test-member2a-${runId}@example.com`;
const treasurerAEmail = `wc-backdate-test-treasurera-${runId}@example.com`;
const ownerBEmail = `wc-backdate-test-ownerb-${runId}@example.com`;
const memberBEmail = `wc-backdate-test-memberb-${runId}@example.com`;
const testPassword = generateTestPassword();

describe.skipIf(!isConfigured)("back-dated contribution import (live)", () => {
  let adminClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let memberAClient: SupabaseClient;
  let member2AClient: SupabaseClient;
  let treasurerAClient: SupabaseClient;
  let ownerBClient: SupabaseClient;
  let memberBClient: SupabaseClient;
  let ownerAId: string;
  let memberAId: string;
  let member2AId: string;
  let treasurerAId: string;
  let ownerBId: string;
  let memberBId: string;
  let groupAId: string;
  let groupBId: string;
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

    const ownerA = await createConfirmedUser(ownerAEmail, "Backdate Test Owner A");
    ownerAId = ownerA.id;
    ownerAClient = ownerA.client;
    const memberA = await createConfirmedUser(memberAEmail, "Backdate Test Member A");
    memberAId = memberA.id;
    memberAClient = memberA.client;
    const member2A = await createConfirmedUser(member2AEmail, "Backdate Test Member 2A");
    member2AId = member2A.id;
    member2AClient = member2A.client;
    const treasurerA = await createConfirmedUser(treasurerAEmail, "Backdate Test Treasurer A");
    treasurerAId = treasurerA.id;
    treasurerAClient = treasurerA.client;
    const ownerB = await createConfirmedUser(ownerBEmail, "Backdate Test Owner B");
    ownerBId = ownerB.id;
    ownerBClient = ownerB.client;
    const memberB = await createConfirmedUser(memberBEmail, "Backdate Test Member B");
    memberBId = memberB.id;
    memberBClient = memberB.client;

    await adminClient.from("organiser_applications").insert({ user_id: ownerAId, status: "approved" });
    const { data: groupA } = await ownerAClient.rpc("create_group_with_setup", {
      p_name: "Backdate Test Group A",
      p_slug: `backdate-test-group-a-${runId}`,
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
    groupAId = groupA![0].group_id;
    await adminClient.from("groups").update({ status: "active" }).eq("id", groupAId);

    await adminClient.from("organiser_applications").insert({ user_id: ownerBId, status: "approved" });
    const { data: groupB } = await ownerBClient.rpc("create_group_with_setup", {
      p_name: "Backdate Test Group B",
      p_slug: `backdate-test-group-b-${runId}`,
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
    groupBId = groupB![0].group_id;
    await adminClient.from("groups").update({ status: "active" }).eq("id", groupBId);

    async function invite(ownerClient: SupabaseClient, groupId: string, email: string, role: string, memberClient: SupabaseClient) {
      const { data } = await ownerClient.rpc("create_invitation", { p_group_id: groupId, p_email: email, p_role: role });
      await memberClient.rpc("accept_invitation", { p_token: data![0].raw_token });
    }

    await invite(ownerAClient, groupAId, memberAEmail, "member", memberAClient);
    await invite(ownerAClient, groupAId, member2AEmail, "member", member2AClient);
    await invite(ownerAClient, groupAId, treasurerAEmail, "treasurer", treasurerAClient);
    await invite(ownerBClient, groupBId, memberBEmail, "member", memberBClient);
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupAId) await adminClient.from("groups").delete().eq("id", groupAId);
    if (groupBId) await adminClient.from("groups").delete().eq("id", groupBId);
    if (createdUserIds.length) {
      await adminClient.from("organiser_applications").delete().in("user_id", createdUserIds);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  let recordId: string;

  it("lets an owner record a manual back-dated contribution, already verified", async () => {
    // A freshly-created test group's created_at is "now", so any
    // historical date is technically "before the group existed" —
    // exactly what the implausible-date check is designed to catch.
    // A real onboarding admin would tick the same override checkbox.
    const { data, error } = await ownerAClient.rpc("record_backdated_contribution", {
      p_group_id: groupAId,
      p_member_id: memberAId,
      p_amount_minor_units: 5000,
      p_received_at: "2020-01-15",
      p_note: "Paper ledger onboarding",
      p_confirm_implausible_date: true,
    });
    expect(error).toBeNull();
    expect(data![0].is_backdated).toBe(true);
    recordId = data![0].record_id;

    const { data: row } = await ownerAClient
      .from("contribution_records")
      .select("status, is_backdated, created_by, received_at")
      .eq("id", recordId)
      .single();
    expect(row?.status).toBe("verified");
    expect(row?.is_backdated).toBe(true);
    expect(row?.created_by).toBe(ownerAId);
    expect(row?.received_at).toBe("2020-01-15");
  });

  it("rejects a treasurer and a plain member from recording a back-dated contribution", async () => {
    const asTreasurer = await treasurerAClient.rpc("record_backdated_contribution", {
      p_group_id: groupAId,
      p_member_id: memberAId,
      p_amount_minor_units: 1000,
      p_received_at: "2020-02-01",
      p_note: null,
      p_confirm_implausible_date: false,
    });
    expect(asTreasurer.error).not.toBeNull();
    expect(asTreasurer.error?.message).toMatch(/owners and administrators/i);

    const asMember = await memberAClient.rpc("record_backdated_contribution", {
      p_group_id: groupAId,
      p_member_id: memberAId,
      p_amount_minor_units: 1000,
      p_received_at: "2020-02-01",
      p_note: null,
      p_confirm_implausible_date: false,
    });
    expect(asMember.error).not.toBeNull();
    expect(asMember.error?.message).toMatch(/owners and administrators/i);
  });

  it("soft-warns on an implausible date, then allows it with explicit confirmation", async () => {
    const futureDate = "2099-01-01";

    const first = await ownerAClient.rpc("record_backdated_contribution", {
      p_group_id: groupAId,
      p_member_id: memberAId,
      p_amount_minor_units: 1000,
      p_received_at: futureDate,
      p_note: null,
      p_confirm_implausible_date: false,
    });
    expect(first.error).not.toBeNull();
    expect(first.error?.message).toMatch(/IMPLAUSIBLE_DATE/);

    const second = await ownerAClient.rpc("record_backdated_contribution", {
      p_group_id: groupAId,
      p_member_id: memberAId,
      p_amount_minor_units: 1000,
      p_received_at: futureDate,
      p_note: null,
      p_confirm_implausible_date: true,
    });
    expect(second.error).toBeNull();
  });

  it("bulk-imports rows, resolving by email and by member id, rejecting an unmatched member without creating one", async () => {
    const rows = [
      { member_identifier: memberAEmail, amount_minor_units: 2000, received_at: "2019-06-01", note: "Row 1" },
      { member_identifier: member2AId, amount_minor_units: 3000, received_at: "2019-07-01", note: "Row 2 by id" },
      { member_identifier: "nobody-real@example.com", amount_minor_units: 1000, received_at: "2019-08-01", note: null },
    ];

    const beforeUserCount = (await adminClient.auth.admin.listUsers({ perPage: 1000 })).data.users.length;

    const { data, error } = await ownerAClient.rpc("bulk_import_contributions", {
      p_group_id: groupAId,
      p_rows: rows,
      p_confirm_implausible_dates: true,
      p_dry_run: false,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(data![0].success).toBe(true);
    expect(data![1].success).toBe(true);
    expect(data![2].success).toBe(false);
    expect(data![2].error_message).toMatch(/no matching member/i);

    const afterUserCount = (await adminClient.auth.admin.listUsers({ perPage: 1000 })).data.users.length;
    expect(afterUserCount).toBe(beforeUserCount);
  });

  it("dry-run preview writes nothing and matches what a real commit would report", async () => {
    const rows = [
      { member_identifier: memberAEmail, amount_minor_units: 4242, received_at: "2018-01-01", note: "dry run row" },
    ];

    const { count: before } = await adminClient
      .from("contribution_records")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupAId);

    const preview = await ownerAClient.rpc("bulk_import_contributions", {
      p_group_id: groupAId,
      p_rows: rows,
      p_confirm_implausible_dates: true,
      p_dry_run: true,
    });
    expect(preview.error).toBeNull();
    expect(preview.data![0].success).toBe(true);
    expect(preview.data![0].record_id).toBeNull();

    const { count: after } = await adminClient
      .from("contribution_records")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupAId);
    expect(after).toBe(before);
  });

  it("lets a member confirm their own back-dated record, but not another member's, and not a manager either", async () => {
    const otherClientDenied = await member2AClient.rpc("confirm_backdated_contribution", { p_record_id: recordId });
    expect(otherClientDenied.error).not.toBeNull();
    expect(otherClientDenied.error?.message).toMatch(/only confirm your own/i);

    const managerDenied = await ownerAClient.rpc("confirm_backdated_contribution", { p_record_id: recordId });
    expect(managerDenied.error).not.toBeNull();
    expect(managerDenied.error?.message).toMatch(/only confirm your own/i);

    const { error } = await memberAClient.rpc("confirm_backdated_contribution", { p_record_id: recordId });
    expect(error).toBeNull();

    const { data: row } = await memberAClient
      .from("contribution_records")
      .select("confirmed_by, confirmed_at")
      .eq("id", recordId)
      .single();
    expect(row?.confirmed_by).toBe(memberAId);
    expect(row?.confirmed_at).toBeTruthy();
  });

  it("does not let a member confirm a normal (non-backdated) contribution", async () => {
    const { data: normalRecord, error: recordError } = await ownerAClient.rpc("record_contribution", {
      p_group_id: groupAId,
      p_member_id: memberAId,
      p_contribution_plan_id: null,
      p_amount_minor_units: 500,
      p_period_start: "2026-01-01",
      p_period_end: "2026-01-31",
      p_received_at: "2026-01-05",
      p_payment_method: "cash",
      p_payment_reference: null,
      p_notes: null,
    });
    expect(recordError).toBeNull();

    const { error } = await memberAClient.rpc("confirm_backdated_contribution", {
      p_record_id: normalRecord![0].record_id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only imported or back-dated records/i);
  });

  it("does not let a manager of group B record a back-dated contribution for a group A member", async () => {
    const { error } = await ownerBClient.rpc("record_backdated_contribution", {
      p_group_id: groupAId,
      p_member_id: memberAId,
      p_amount_minor_units: 1000,
      p_received_at: "2020-01-01",
      p_note: null,
      p_confirm_implausible_date: false,
    });
    expect(error).not.toBeNull();
  });

  it("does not let a member of group A read group B's contribution history", async () => {
    const { data: bRecord } = await ownerBClient.rpc("record_backdated_contribution", {
      p_group_id: groupBId,
      p_member_id: memberBId,
      p_amount_minor_units: 1000,
      p_received_at: "2020-01-01",
      p_note: null,
      p_confirm_implausible_date: true,
    });

    const { data, error } = await memberAClient
      .from("contribution_records")
      .select("*")
      .eq("id", bRecord![0].record_id);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
