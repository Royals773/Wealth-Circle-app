"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { memberProfileSchema, type MemberProfileInput } from "@/lib/validations/member-profile";

export interface MemberProfileActionState {
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
 * Called directly from a client component (no <form action>, per the
 * request that drove this file) rather than bound to useActionState —
 * same shape as setNotificationPreferenceAction. Re-validates with the
 * same Zod schema the client already checked against, since client-side
 * validation is a UX convenience only, never the real boundary; RLS on
 * member_profiles (member_profiles_insert_own) is what actually
 * enforces that a caller can only ever write their own row, for a
 * group they're genuinely an active member of.
 */
export async function submitMemberProfileAction(
  input: MemberProfileInput,
): Promise<MemberProfileActionState> {
  const parsed = memberProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
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

  const d = parsed.data;
  const { error } = await supabase.from("member_profiles").insert({
    user_id: user.id,
    group_id: d.groupId,
    first_name: d.firstName,
    middle_name: d.middleName || null,
    last_name: d.lastName,
    date_of_birth: d.dateOfBirth,
    gender: d.gender ?? null,
    phone: d.phone,
    email: d.email,
    address_line1: d.addressLine1,
    address_line2: d.addressLine2 || null,
    city: d.city,
    postcode: d.postcode,
    country: d.country,
    next_of_kin_full_name: d.nextOfKinFullName,
    next_of_kin_relationship: d.nextOfKinRelationship,
    next_of_kin_phone: d.nextOfKinPhone,
    next_of_kin_email: d.nextOfKinEmail || null,
    // Set here, server-side, only after Zod's informationConfirmed:
    // z.literal(true) has already rejected any submission where the
    // consent checkbox wasn't ticked — an auditable consent record,
    // not just a UI gate.
    consent_given_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return { status: "error", formError: "A profile has already been submitted for this group." };
    }
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${d.groupId}/members`);
  return { status: "success" };
}
