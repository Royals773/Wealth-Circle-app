import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { GroupStatus, OrganiserApplicationStatus } from "@/lib/types/database";

export interface PendingGroupReview {
  id: string;
  name: string;
  slug: string;
  status: GroupStatus;
  createdAt: string;
  ownerEmail: string | null;
}

export interface OrganiserApplicationRow {
  userId: string;
  status: OrganiserApplicationStatus;
  applicationNote: string | null;
  submittedAt: string;
  email: string | null;
  fullName: string | null;
}

/**
 * Independently re-checks is_platform_admin() — the real boundary. This
 * function is the gate every page/loader in the platform-admin area
 * calls before doing anything else; the page being absent from nav is
 * not itself a security control (see docs/security-boundaries.md).
 */
export async function isPlatformAdmin(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true;
}

export async function loadPendingGroupReviews(): Promise<PendingGroupReview[]> {
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("groups")
    .select("id, name, slug, status, created_at, created_by")
    .eq("status", "pending_review")
    .order("created_at", { ascending: true });

  if (!groups || groups.length === 0) return [];

  const creatorIds = [...new Set(groups.map((g) => g.created_by))];
  const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", creatorIds);
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    slug: g.slug,
    status: g.status,
    createdAt: g.created_at,
    ownerEmail: emailById.get(g.created_by) ?? null,
  }));
}

export async function loadActiveGroupsForModeration(): Promise<PendingGroupReview[]> {
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("groups")
    .select("id, name, slug, status, created_at, created_by")
    .in("status", ["active", "suspended"])
    .order("name", { ascending: true });

  if (!groups || groups.length === 0) return [];

  const creatorIds = [...new Set(groups.map((g) => g.created_by))];
  const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", creatorIds);
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    slug: g.slug,
    status: g.status,
    createdAt: g.created_at,
    ownerEmail: emailById.get(g.created_by) ?? null,
  }));
}

async function loadOrganiserApplicationsByStatus(
  statuses: OrganiserApplicationStatus[],
): Promise<OrganiserApplicationRow[]> {
  const supabase = await createClient();
  const { data: apps } = await supabase
    .from("organiser_applications")
    .select("user_id, status, application_note, submitted_at")
    .in("status", statuses)
    .order("submitted_at", { ascending: true });

  if (!apps || apps.length === 0) return [];

  const userIds = [...new Set(apps.map((a) => a.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return apps.map((a) => ({
    userId: a.user_id,
    status: a.status,
    applicationNote: a.application_note,
    submittedAt: a.submitted_at,
    email: profileById.get(a.user_id)?.email ?? null,
    fullName: profileById.get(a.user_id)?.full_name ?? null,
  }));
}

export function loadPendingOrganiserApplications(): Promise<OrganiserApplicationRow[]> {
  return loadOrganiserApplicationsByStatus(["pending"]);
}

export function loadActiveOrganisers(): Promise<OrganiserApplicationRow[]> {
  return loadOrganiserApplicationsByStatus(["approved", "suspended"]);
}

export async function loadGroupOwnerCounts(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase
    .from("group_memberships")
    .select("user_id, group_id")
    .in("user_id", userIds)
    .eq("role", "owner")
    .eq("status", "active");

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }
  return counts;
}
