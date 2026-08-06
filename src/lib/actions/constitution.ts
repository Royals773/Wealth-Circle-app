"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  publishConstitutionSchema,
  acknowledgeConstitutionSchema,
  validateConstitutionFile,
  hasPdfMagicBytes,
} from "@/lib/validations/constitution";

export interface ConstitutionActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
}

const NOT_CONFIGURED_MESSAGE =
  "This isn't available in this preview yet — Supabase credentials haven't been configured.";

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/**
 * Publishes a new constitution version: uploads the PDF to Storage
 * (respecting the constitutions_storage_insert_managers RLS policy —
 * an unauthorized caller's upload is rejected by Storage itself, this
 * function isn't the real boundary), then calls
 * publish_group_constitution() to atomically assign the next version
 * number and write the row. If the RPC fails after a successful
 * upload (e.g. a role changed in between), the orphaned file is
 * deleted rather than left dangling with no matching row.
 */
export async function publishConstitutionAction(
  groupId: string,
  _prevState: ConstitutionActionState,
  formData: FormData,
): Promise<ConstitutionActionState> {
  const parsed = publishConstitutionSchema.safeParse({
    groupId,
    title: formData.get("title"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const file = formData.get("file");
  const fileError = validateConstitutionFile(file instanceof File ? file : null);
  if (fileError) {
    return { status: "error", fieldErrors: { file: fileError } };
  }
  if (!(await hasPdfMagicBytes(file as File))) {
    return { status: "error", fieldErrors: { file: "The uploaded file doesn't look like a valid PDF" } };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", formError: "Not authenticated" };
  }

  const storagePath = `${groupId}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("constitutions")
    .upload(storagePath, file as File, { contentType: "application/pdf" });
  if (uploadError) {
    return { status: "error", formError: uploadError.message };
  }

  const { error: publishError } = await supabase.rpc("publish_group_constitution", {
    p_group_id: parsed.data.groupId,
    p_storage_path: storagePath,
    p_title: parsed.data.title,
    p_note: parsed.data.note || null,
  });

  if (publishError) {
    await supabase.storage.from("constitutions").remove([storagePath]);
    return { status: "error", formError: publishError.message };
  }

  revalidatePath(`/dashboard/${groupId}/constitution`);
  return { status: "success" };
}

export async function acknowledgeConstitutionAction(
  groupId: string,
  constitutionId: string,
): Promise<{ error?: string }> {
  const parsed = acknowledgeConstitutionSchema.safeParse({ constitutionId });
  if (!parsed.success) {
    return { error: "Invalid request" };
  }
  if (!isSupabaseConfigured) {
    return { error: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_group_constitution", {
    p_constitution_id: parsed.data.constitutionId,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/constitution`);
  revalidatePath(`/dashboard/${groupId}`, "layout");
  return {};
}
