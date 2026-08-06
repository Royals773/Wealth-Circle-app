import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface ConstitutionVersion {
  id: string;
  version: number;
  title: string;
  note: string | null;
  publishedAt: string;
  storagePath: string;
}

export interface ConstitutionGateStatus {
  /** No version has ever been published — nothing to gate or show yet. */
  hasConstitution: boolean;
  /** The caller has acknowledged at least one version (not necessarily the latest) — this alone is enough to not be blocked. */
  hasAcknowledgedAny: boolean;
  /** A version newer than whatever the caller last acknowledged exists — drives the non-blocking update banner. */
  hasNewerVersionThanAcknowledged: boolean;
  current: ConstitutionVersion | null;
}

const SIGNED_URL_EXPIRY_SECONDS = 300;

export async function loadCurrentConstitution(groupId: string): Promise<ConstitutionVersion | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("group_constitutions")
    .select("id, version, title, note, published_at, storage_path")
    .eq("group_id", groupId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    version: data.version,
    title: data.title,
    note: data.note,
    publishedAt: data.published_at,
    storagePath: data.storage_path,
  };
}

export async function loadConstitutionVersions(groupId: string): Promise<ConstitutionVersion[]> {
  if (!isSupabaseConfigured) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("group_constitutions")
    .select("id, version, title, note, published_at, storage_path")
    .eq("group_id", groupId)
    .order("version", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    version: row.version,
    title: row.title,
    note: row.note,
    publishedAt: row.published_at,
    storagePath: row.storage_path,
  }));
}

/**
 * The gating check used by the group layout. Deliberately checks
 * "acknowledged *any* version" rather than "acknowledged the latest
 * version" — re-publishing a correction must never retroactively
 * block members who already signed an earlier one, per the explicit
 * requirement this feature was built against.
 */
export async function loadConstitutionGateStatus(groupId: string, userId: string): Promise<ConstitutionGateStatus> {
  if (!isSupabaseConfigured) {
    return { hasConstitution: false, hasAcknowledgedAny: false, hasNewerVersionThanAcknowledged: false, current: null };
  }

  const supabase = await createClient();
  const [current, { data: acknowledgements }] = await Promise.all([
    loadCurrentConstitution(groupId),
    supabase
      .from("constitution_acknowledgements")
      .select("constitution_id")
      .eq("group_id", groupId)
      .eq("user_id", userId),
  ]);

  if (!current) {
    return { hasConstitution: false, hasAcknowledgedAny: false, hasNewerVersionThanAcknowledged: false, current: null };
  }

  const acknowledgedIds = (acknowledgements ?? []).map((r) => r.constitution_id);
  const hasAcknowledgedAny = acknowledgedIds.length > 0;

  let highestAcknowledgedVersion = 0;
  if (hasAcknowledgedAny) {
    const { data: acknowledgedVersions } = await supabase
      .from("group_constitutions")
      .select("version")
      .in("id", acknowledgedIds);
    highestAcknowledgedVersion = (acknowledgedVersions ?? []).reduce((max, r) => Math.max(max, r.version), 0);
  }

  return {
    hasConstitution: true,
    hasAcknowledgedAny,
    hasNewerVersionThanAcknowledged: hasAcknowledgedAny && highestAcknowledgedVersion < current.version,
    current,
  };
}

export async function hasAcknowledgedConstitution(groupId: string, constitutionId: string, userId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("constitution_acknowledgements")
    .select("id")
    .eq("group_id", groupId)
    .eq("constitution_id", constitutionId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/**
 * A short-lived signed URL, generated through the caller's own
 * authenticated session — Storage RLS (constitutions_storage_select_members)
 * applies to this call exactly as it would to any other access, so a
 * non-member gets a permission error here, not a URL.
 */
export async function getConstitutionDownloadUrl(storagePath: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("constitutions")
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}
