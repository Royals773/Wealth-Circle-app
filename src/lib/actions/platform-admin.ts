"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

const NOT_CONFIGURED_MESSAGE =
  "This isn't available in this preview yet — Supabase credentials haven't been configured.";

type AdminRpcName =
  | "decide_group_review"
  | "suspend_group"
  | "reactivate_group"
  | "decide_organiser_application"
  | "suspend_organiser"
  | "reactivate_organiser"
  | "set_platform_config_int";

/**
 * Every action below calls a SECURITY DEFINER RPC that independently
 * re-checks is_platform_admin() itself (see
 * 0024_phase10_platform_authorisation.sql) — this file adds no
 * additional authorisation of its own, and none is needed: the RPC is
 * the real boundary, this is just the calling convention. The
 * platform-admin page's own loader performs a separate is_platform_admin()
 * check before rendering, so a non-admin who somehow reaches this file
 * still can't do anything through it.
 *
 * The cast below is narrowly scoped to this one dispatch point: each
 * exported action function still has a fully-typed signature (see
 * below), so callers get real type safety — only this internal
 * generic-RPC-name plumbing needs to bypass supabase-js's per-RPC
 * function-argument overloads.
 */
async function callAdminRpc(
  rpc: AdminRpcName,
  args: Record<string, string | number | null>,
  revalidate: string,
): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: NOT_CONFIGURED_MESSAGE };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    rpc as keyof Database["public"]["Functions"],
    args as never,
  );
  if (error) {
    return { error: error.message };
  }
  revalidatePath(revalidate);
  return {};
}

export async function decideGroupReviewAction(
  groupId: string,
  decision: "active" | "rejected",
  reason: string,
): Promise<{ error?: string }> {
  return callAdminRpc(
    "decide_group_review",
    { p_group_id: groupId, p_decision: decision, p_reason: reason || null },
    "/platform-admin",
  );
}

export async function suspendGroupAction(groupId: string, reason: string): Promise<{ error?: string }> {
  return callAdminRpc("suspend_group", { p_group_id: groupId, p_reason: reason }, "/platform-admin");
}

export async function reactivateGroupAction(groupId: string, reason: string): Promise<{ error?: string }> {
  return callAdminRpc(
    "reactivate_group",
    { p_group_id: groupId, p_reason: reason || null },
    "/platform-admin",
  );
}

export async function decideOrganiserApplicationAction(
  userId: string,
  decision: "approved" | "rejected",
  reason: string,
): Promise<{ error?: string }> {
  return callAdminRpc(
    "decide_organiser_application",
    { p_user_id: userId, p_decision: decision, p_reason: reason || null },
    "/platform-admin",
  );
}

export async function suspendOrganiserAction(userId: string, reason: string): Promise<{ error?: string }> {
  return callAdminRpc("suspend_organiser", { p_user_id: userId, p_reason: reason }, "/platform-admin");
}

export async function reactivateOrganiserAction(userId: string, reason: string): Promise<{ error?: string }> {
  return callAdminRpc(
    "reactivate_organiser",
    { p_user_id: userId, p_reason: reason || null },
    "/platform-admin",
  );
}

export async function setPlatformConfigAction(
  key: string,
  value: number,
  reason: string,
): Promise<{ error?: string }> {
  return callAdminRpc(
    "set_platform_config_int",
    { p_key: key, p_value: value, p_reason: reason || null },
    "/platform-admin",
  );
}
