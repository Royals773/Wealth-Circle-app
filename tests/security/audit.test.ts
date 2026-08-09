/**
 * Live RLS tests for the Phase 8 audit log viewer.
 *
 * The audit log viewer (src/app/(dashboard)/dashboard/[groupId]/audit/)
 * adds no new schema and no new RLS — audit_logs' policies have been
 * unchanged since Phase 1 (SELECT for owner/administrator/auditor only,
 * INSERT with actor_id forgery prevention, no UPDATE/DELETE policy at
 * all). These tests confirm the guarantees the new viewer depends on
 * still hold, plus the specific filter/domain behaviour the viewer adds
 * on top (src/lib/data/audit-summary.ts's categorizeAuditAction).
 *
 * Same shape and setup as tests/security/reports.test.ts. Skipped (not
 * failed) when Supabase env vars aren't present.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerEmail = `wc-audit-test-owner-${runId}@example.com`;
const treasurerEmail = `wc-audit-test-treasurer-${runId}@example.com`;
const auditorEmail = `wc-audit-test-auditor-${runId}@example.com`;
const memberEmail = `wc-audit-test-member-${runId}@example.com`;
const otherOwnerEmail = `wc-audit-test-other-${runId}@example.com`;
const testPassword = "AuditTest123!";

describe.skipIf(!isConfigured)("audit log (live)", () => {
  let adminClient: SupabaseClient;
  let ownerClient: SupabaseClient;
  let treasurerClient: SupabaseClient;
  let auditorClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let otherOwnerClient: SupabaseClient;
  let ownerId: string;
  let treasurerId: string;
  let auditorId: string;
  let memberId: string;
  let otherOwnerId: string;
  let groupId: string;
  let otherGroupId: string;
  let sampleAuditId: string;

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

    const owner = await createConfirmedUser(ownerEmail, "Audit Test Owner");
    ownerId = owner.id;
    ownerClient = owner.client;

    const treasurer = await createConfirmedUser(treasurerEmail, "Audit Test Treasurer");
    treasurerId = treasurer.id;
    treasurerClient = treasurer.client;

    const auditor = await createConfirmedUser(auditorEmail, "Audit Test Auditor");
    auditorId = auditor.id;
    auditorClient = auditor.client;

    const member = await createConfirmedUser(memberEmail, "Audit Test Member");
    memberId = member.id;
    memberClient = member.client;

    const otherOwner = await createConfirmedUser(otherOwnerEmail, "Audit Test Other Owner");
    otherOwnerId = otherOwner.id;
    otherOwnerClient = otherOwner.client;

    await adminClient.from("organiser_applications").insert({ user_id: ownerId, status: "approved" });
    const { data: group } = await ownerClient.rpc("create_group_with_setup", {
      p_name: "Audit Test Group",
      p_slug: `audit-test-group-${runId}`,
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
      p_name: "Audit Test Other Group",
      p_slug: `audit-test-other-group-${runId}`,
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
      const { data } = await ownerClient.rpc("create_invitation", { p_group_id: groupId, p_email: email, p_role: role });
      return data![0].raw_token as string;
    }

    await treasurerClient.rpc("accept_invitation", { p_token: await invite(treasurerEmail, "treasurer") });
    await auditorClient.rpc("accept_invitation", { p_token: await invite(auditorEmail, "auditor") });
    await memberClient.rpc("accept_invitation", { p_token: await invite(memberEmail, "member") });

    // change_member_role() itself writes a real audit_logs row we can
    // use as a known sample — no need to insert one directly.
    await ownerClient.rpc("change_member_role", {
      p_group_id: groupId,
      p_member_id: memberId,
      p_new_role: "treasurer",
      p_reason: "audit log test sample event",
    });
    const { data: sample } = await adminClient
      .from("audit_logs")
      .select("id")
      .eq("group_id", groupId)
      .eq("action", "member_role_changed")
      .eq("entity_id", memberId)
      .single();
    sampleAuditId = sample!.id;

    // Restore the member's role so later assertions about "member"
    // capability boundaries remain accurate.
    await ownerClient.rpc("change_member_role", {
      p_group_id: groupId,
      p_member_id: memberId,
      p_new_role: "member",
      p_reason: "revert after audit log test sample event",
    });
  });

  afterAll(async () => {
    if (!adminClient) return;
    if (groupId) await adminClient.from("groups").delete().eq("id", groupId);
    if (otherGroupId) await adminClient.from("groups").delete().eq("id", otherGroupId);
    if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
    if (treasurerId) await adminClient.auth.admin.deleteUser(treasurerId);
    if (auditorId) await adminClient.auth.admin.deleteUser(auditorId);
    if (memberId) await adminClient.auth.admin.deleteUser(memberId);
    if (otherOwnerId) await adminClient.auth.admin.deleteUser(otherOwnerId);
  });

  it("lets the owner and auditor read the group's audit log", async () => {
    const { data: asOwner } = await ownerClient.from("audit_logs").select("id").eq("id", sampleAuditId);
    expect(asOwner?.length).toBe(1);

    const { data: asAuditor } = await auditorClient.from("audit_logs").select("id").eq("id", sampleAuditId);
    expect(asAuditor?.length).toBe(1);
  });

  it("does not let a treasurer (view_reports, but not view_audit_log) read the audit log", async () => {
    const { data } = await treasurerClient.from("audit_logs").select("id").eq("id", sampleAuditId);
    expect(data ?? []).toEqual([]);
  });

  it("does not let an ordinary member read the audit log", async () => {
    const { data } = await memberClient.from("audit_logs").select("id").eq("id", sampleAuditId);
    expect(data ?? []).toEqual([]);
  });

  it("does not let a manager of another group read this group's audit log", async () => {
    const { data } = await otherOwnerClient.from("audit_logs").select("id").eq("id", sampleAuditId);
    expect(data ?? []).toEqual([]);
  });

  it("is append-only: no UPDATE policy exists, so even the owner's update matches zero rows", async () => {
    // No UPDATE policy at all means the row simply doesn't pass the
    // (nonexistent) USING clause — Postgres excludes it from the
    // updatable set entirely rather than raising an error, the same
    // "silent no-op" semantics documented elsewhere in this schema.
    const { data, error } = await ownerClient
      .from("audit_logs")
      .update({ action: "tampered_action" })
      .eq("id", sampleAuditId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: unchanged } = await adminClient.from("audit_logs").select("action").eq("id", sampleAuditId).single();
    expect(unchanged?.action).toBe("member_role_changed");
  });

  it("is append-only: no DELETE policy exists, so even the owner's delete matches zero rows", async () => {
    const { data, error } = await ownerClient.from("audit_logs").delete().eq("id", sampleAuditId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: stillThere } = await adminClient.from("audit_logs").select("id").eq("id", sampleAuditId);
    expect(stillThere?.length).toBe(1);
  });

  it("preserves the original actor identity even after that member's own role later changed", async () => {
    const { data } = await ownerClient.from("audit_logs").select("actor_id").eq("id", sampleAuditId).single();
    expect(data?.actor_id).toBe(ownerId);
  });

  it("cannot be forged: a member cannot insert an audit row claiming another user as actor", async () => {
    const { data, error } = await memberClient
      .from("audit_logs")
      .insert({
        group_id: groupId,
        actor_id: ownerId,
        action: "forged_action",
        entity_type: "test",
        entity_id: null,
        metadata: {},
      })
      .select();
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("records a distinct action and entity_type per event, enough for domain categorization", async () => {
    const { data } = await ownerClient
      .from("audit_logs")
      .select("action, entity_type")
      .eq("id", sampleAuditId)
      .single();
    expect(data?.action).toBe("member_role_changed");
    expect(data?.entity_type).toBe("group_memberships");
  });
});
