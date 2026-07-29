"use server";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createGroupSchema, joinGroupSchema } from "@/lib/validations/group";
import { redirect } from "next/navigation";

export interface OnboardingActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
}

export const initialOnboardingActionState: OnboardingActionState = { status: "idle" };

const NOT_CONFIGURED_MESSAGE =
  "Group creation isn't available in this preview yet — Supabase credentials haven't been " +
  "configured. See .env.example for the variables an operator needs to add.";

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function createGroupAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const rawInvites = formData.get("invites");
  let invites: unknown = [];
  try {
    invites = rawInvites ? JSON.parse(String(rawInvites)) : [];
  } catch {
    return { status: "error", formError: "The member invite list could not be read." };
  }

  const parsed = createGroupSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") || undefined,
    countryCode: formData.get("countryCode"),
    currencyCode: formData.get("currencyCode"),
    contributionFrequency: formData.get("contributionFrequency"),
    contributionType: formData.get("contributionType"),
    fixedAmountMajorUnits: formData.get("fixedAmountMajorUnits") || undefined,
    financialYearStartMonth: formData.get("financialYearStartMonth"),
    rules: formData.get("rules") || undefined,
    invites,
  });

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
    redirect("/sign-in");
  }

  const { majorToMinorUnits } = await import("@/lib/money");
  const { data: group, error } = await supabase
    .from("groups")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
      country_code: parsed.data.countryCode,
      currency_code: parsed.data.currencyCode,
      contribution_frequency: parsed.data.contributionFrequency,
      contribution_type: parsed.data.contributionType,
      financial_year_start_month: parsed.data.financialYearStartMonth,
      rules: parsed.data.rules ?? null,
      created_by: user.id,
    })
    .select("id, slug")
    .single();

  if (error || !group) {
    return { status: "error", formError: error?.message ?? "Could not create the group." };
  }

  if (parsed.data.contributionType === "fixed" && parsed.data.fixedAmountMajorUnits) {
    await supabase.from("contribution_plans").insert({
      group_id: group.id,
      name: "Standard contribution",
      amount_minor_units: majorToMinorUnits(
        parsed.data.fixedAmountMajorUnits,
        parsed.data.currencyCode,
      ),
      currency_code: parsed.data.currencyCode,
      frequency: parsed.data.contributionFrequency,
      is_flexible: false,
      start_date: new Date().toISOString().slice(0, 10),
      created_by: user.id,
    });
  }

  if (parsed.data.invites.length > 0) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("group_invitations").insert(
      parsed.data.invites.map((invite) => ({
        group_id: group.id,
        email: invite.email,
        role: invite.role,
        invited_by: user.id,
        expires_at: expiresAt,
      })),
    );
  }

  redirect(`/dashboard/${group.id}`);
}

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export async function joinGroupAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const raw = String(formData.get("invitationToken") ?? "");
  const extractedToken = raw.match(UUID_PATTERN)?.[0] ?? raw;

  const parsed = joinGroupSchema.safeParse({ invitationToken: extractedToken });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: { invitationToken: "Enter a valid invitation link or code." },
    };
  }

  redirect(`/invitations/${parsed.data.invitationToken}`);
}
