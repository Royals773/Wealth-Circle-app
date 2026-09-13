/**
 * Live RLS, RPC, and Storage policy tests for the group constitution
 * feature.
 *
 * Same shape and setup as tests/security/governance.test.ts: runs
 * against the real Supabase project configured in the environment,
 * skipped (not failed) when the required env vars aren't present.
 * Requires supabase/migrations/0020_group_constitutions.sql to already
 * be applied.
 *
 * Covers the table/RPC/Storage-policy security boundary directly, the
 * same way every other file in this folder does — signed-in
 * publishable-key clients only, never the admin client for assertions.
 * The magic-byte content check (src/lib/validations/constitution.ts)
 * is an application-layer gate, not an RLS/Storage policy, and is
 * covered separately by src/lib/validations/constitution.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateTestPassword } from "./test-fixtures";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const isConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

const runId = Date.now().toString(36);
const ownerAEmail = `wc-constitution-test-ownera-${runId}@example.com`;
const memberAEmail = `wc-constitution-test-membera-${runId}@example.com`;
const member2AEmail = `wc-constitution-test-member2a-${runId}@example.com`;
const ownerBEmail = `wc-constitution-test-ownerb-${runId}@example.com`;
const testPassword = generateTestPassword();

// A minimal but genuinely valid one-page PDF (not a stub with only the
// magic bytes) — real content, so Storage actually stores real PDF
// bytes rather than a synthetic fragment.
const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

function pdfFile(name: string) {
  return new File([PDF_BYTES], name, { type: "application/pdf" });
}

describe.skipIf(!isConfigured)("group constitutions (live)", () => {
  let adminClient: SupabaseClient;
  let ownerAClient: SupabaseClient;
  let memberAClient: SupabaseClient;
  let member2AClient: SupabaseClient;
  let ownerBClient: SupabaseClient;
  let ownerAId: string;
  let memberAId: string;
  let member2AId: string;
  let ownerBId: string;
  let groupAId: string;
  let groupBId: string;
  const uploadedPaths: string[] = [];
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

    const ownerA = await createConfirmedUser(ownerAEmail, "Constitution Test Owner A");
    ownerAId = ownerA.id;
    ownerAClient = ownerA.client;

    const memberA = await createConfirmedUser(memberAEmail, "Constitution Test Member A");
    memberAId = memberA.id;
    memberAClient = memberA.client;

    const member2A = await createConfirmedUser(member2AEmail, "Constitution Test Member 2A");
    member2AId = member2A.id;
    member2AClient = member2A.client;

    const ownerB = await createConfirmedUser(ownerBEmail, "Constitution Test Owner B");
    ownerBId = ownerB.id;
    ownerBClient = ownerB.client;

    await adminClient.from("organiser_applications").insert({ user_id: ownerAId, status: "approved" });
    const { data: groupA } = await ownerAClient.rpc("create_group_with_setup", {
      p_name: "Constitution Test Group A",
      p_slug: `constitution-test-group-a-${runId}`,
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
      p_name: "Constitution Test Group B",
      p_slug: `constitution-test-group-b-${runId}`,
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

    async function invite(ownerClient: SupabaseClient, groupId: string, email: string, memberClient: SupabaseClient) {
      const { data: invite } = await ownerClient.rpc("create_invitation", {
        p_group_id: groupId,
        p_email: email,
        p_role: "member",
      });
      await memberClient.rpc("accept_invitation", { p_token: invite![0].raw_token });
    }

    await invite(ownerAClient, groupAId, memberAEmail, memberAClient);
    await invite(ownerAClient, groupAId, member2AEmail, member2AClient);
  });

  afterAll(async () => {
    if (!adminClient) return;
    for (const path of uploadedPaths) {
      await adminClient.storage.from("constitutions").remove([path]);
    }
    if (groupAId) await adminClient.from("groups").delete().eq("id", groupAId);
    if (groupBId) await adminClient.from("groups").delete().eq("id", groupBId);
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id).catch(() => undefined);
    }
  });

  let constitutionAV1Id: string;
  let constitutionAV2Id: string;
  let storagePathAV1: string;
  let storagePathAV2: string;

  it("lets a manager upload and publish the first constitution version", async () => {
    storagePathAV1 = `${groupAId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await ownerAClient.storage
      .from("constitutions")
      .upload(storagePathAV1, pdfFile("v1.pdf"), { contentType: "application/pdf" });
    expect(uploadError).toBeNull();
    uploadedPaths.push(storagePathAV1);

    const { data, error } = await ownerAClient.rpc("publish_group_constitution", {
      p_group_id: groupAId,
      p_storage_path: storagePathAV1,
      p_title: "Group A Constitution",
      p_note: null,
    });
    expect(error).toBeNull();
    expect(data![0].version).toBe(1);
    constitutionAV1Id = data![0].id;
  });

  it("rejects a plain member's attempt to publish", async () => {
    const badPath = `${groupAId}/${crypto.randomUUID()}.pdf`;
    const { error: rpcError } = await memberAClient.rpc("publish_group_constitution", {
      p_group_id: groupAId,
      p_storage_path: badPath,
      p_title: "Member-published constitution",
      p_note: null,
    });
    expect(rpcError).not.toBeNull();
    expect(rpcError?.message).toMatch(/owners and administrators/i);

    // The RPC's own manager check is the primary boundary tested above;
    // this also confirms the Storage RLS policy independently denies the
    // upload a member would need to make before ever reaching the RPC.
    const { error: uploadError } = await memberAClient.storage
      .from("constitutions")
      .upload(badPath, pdfFile("member-attempt.pdf"), { contentType: "application/pdf" });
    expect(uploadError).not.toBeNull();
  });

  it("lets a manager publish a second version without touching the first", async () => {
    storagePathAV2 = `${groupAId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await ownerAClient.storage
      .from("constitutions")
      .upload(storagePathAV2, pdfFile("v2.pdf"), { contentType: "application/pdf" });
    expect(uploadError).toBeNull();
    uploadedPaths.push(storagePathAV2);

    const { data, error } = await ownerAClient.rpc("publish_group_constitution", {
      p_group_id: groupAId,
      p_storage_path: storagePathAV2,
      p_title: "Group A Constitution (corrected)",
      p_note: "Fixed a typo in section 3",
    });
    expect(error).toBeNull();
    expect(data![0].version).toBe(2);
    constitutionAV2Id = data![0].id;

    const { data: versions } = await ownerAClient
      .from("group_constitutions")
      .select("id, version")
      .eq("group_id", groupAId)
      .order("version", { ascending: true });
    expect(versions).toHaveLength(2);
    expect(versions![0]).toMatchObject({ id: constitutionAV1Id, version: 1 });
    expect(versions![1]).toMatchObject({ id: constitutionAV2Id, version: 2 });
  });

  it("does not let a member read another group's constitution rows", async () => {
    const { data, error } = await memberAClient.from("group_constitutions").select("*").eq("group_id", groupBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("does not let a member fetch another group's constitution PDF via signed URL or direct download", async () => {
    const storagePathB = `${groupBId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await ownerBClient.storage
      .from("constitutions")
      .upload(storagePathB, pdfFile("group-b.pdf"), { contentType: "application/pdf" });
    expect(uploadError).toBeNull();
    uploadedPaths.push(storagePathB);
    await ownerBClient.rpc("publish_group_constitution", {
      p_group_id: groupBId,
      p_storage_path: storagePathB,
      p_title: "Group B Constitution",
      p_note: null,
    });

    // Sanity check: group B's own owner CAN generate a signed URL for
    // their own file — proves the policy is a real allow/deny split,
    // not something that fails closed for everyone.
    const { data: ownSignedUrl, error: ownSignedUrlError } = await ownerBClient.storage
      .from("constitutions")
      .createSignedUrl(storagePathB, 60);
    expect(ownSignedUrlError).toBeNull();
    expect(ownSignedUrl?.signedUrl).toBeTruthy();

    // The actual proof: a member of group A, given the exact real
    // storage path (no guessing needed), still can't get a signed URL
    // or download the object.
    const { data: signedUrl, error: signedUrlError } = await memberAClient.storage
      .from("constitutions")
      .createSignedUrl(storagePathB, 60);
    expect(signedUrlError).not.toBeNull();
    expect(signedUrl).toBeNull();

    const { data: download, error: downloadError } = await memberAClient.storage
      .from("constitutions")
      .download(storagePathB);
    expect(downloadError).not.toBeNull();
    expect(download).toBeNull();
  });

  it("records an acknowledgement with the correct user, version, and timestamp", async () => {
    const before = new Date();
    const { error } = await memberAClient.rpc("acknowledge_group_constitution", {
      p_constitution_id: constitutionAV1Id,
    });
    expect(error).toBeNull();

    const { data: ack } = await memberAClient
      .from("constitution_acknowledgements")
      .select("user_id, constitution_id, group_id, acknowledged_at")
      .eq("user_id", memberAId)
      .eq("constitution_id", constitutionAV1Id)
      .single();

    expect(ack?.user_id).toBe(memberAId);
    expect(ack?.constitution_id).toBe(constitutionAV1Id);
    expect(ack?.group_id).toBe(groupAId);
    expect(new Date(ack!.acknowledged_at).getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
  });

  it("is idempotent: acknowledging the same version twice creates no second row", async () => {
    await memberAClient.rpc("acknowledge_group_constitution", { p_constitution_id: constitutionAV1Id });
    const { data: acks } = await memberAClient
      .from("constitution_acknowledgements")
      .select("id")
      .eq("user_id", memberAId)
      .eq("constitution_id", constitutionAV1Id);
    expect(acks).toHaveLength(1);
  });

  it("does not let one member read another member's acknowledgement, even a manager's read", async () => {
    await member2AClient.rpc("acknowledge_group_constitution", { p_constitution_id: constitutionAV1Id });

    const { data: seenByMemberA, error: memberAErr } = await memberAClient
      .from("constitution_acknowledgements")
      .select("*")
      .eq("user_id", member2AId);
    expect(memberAErr).toBeNull();
    expect(seenByMemberA).toHaveLength(0);

    // Explicit per the spec: no manager exception on this table either.
    const { data: seenByOwner, error: ownerErr } = await ownerAClient
      .from("constitution_acknowledgements")
      .select("*")
      .eq("user_id", memberAId);
    expect(ownerErr).toBeNull();
    expect(seenByOwner).toHaveLength(0);
  });

  it("does not let a member acknowledge another group's constitution", async () => {
    const storagePathB2 = `${groupBId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await ownerBClient.storage
      .from("constitutions")
      .upload(storagePathB2, pdfFile("group-b-2.pdf"), { contentType: "application/pdf" });
    expect(uploadError).toBeNull();
    uploadedPaths.push(storagePathB2);
    const { data: pub } = await ownerBClient.rpc("publish_group_constitution", {
      p_group_id: groupBId,
      p_storage_path: storagePathB2,
      p_title: "Group B Constitution v2",
      p_note: null,
    });

    const { error } = await memberAClient.rpc("acknowledge_group_constitution", {
      p_constitution_id: pub![0].id,
    });
    expect(error).not.toBeNull();
    // Not "Not a member of this group" — group_constitutions' own RLS
    // (is_group_member) already hides the row from memberA before this
    // SECURITY INVOKER function's explicit membership check ever runs,
    // so v_group_id comes back null and the earlier "not found" branch
    // fires instead. Same denied outcome either way; this asserts the
    // actual (correct) behavior rather than the unreachable branch.
    expect(error?.message).toMatch(/constitution not found/i);
  });
});
