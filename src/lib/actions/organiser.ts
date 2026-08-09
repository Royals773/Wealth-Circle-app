"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface OrganiserApplicationActionState {
  status: "idle" | "error" | "success";
  formError?: string;
}

const NOT_CONFIGURED_MESSAGE =
  "This isn't available in this preview yet — Supabase credentials haven't been configured.";

export async function applyForOrganiserStatusAction(
  _prevState: OrganiserApplicationActionState,
  formData: FormData,
): Promise<OrganiserApplicationActionState> {
  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_for_organiser_status", {
    p_note: note || null,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath("/apply-organiser");
  return { status: "success" };
}
