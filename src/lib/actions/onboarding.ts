"use server";

import { getAppUrl, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createGroupSchema, joinGroupSchema } from "@/lib/validations/group";
import { redirect } from "next/navigation";
import type { GroupRole } from "@/lib/types/database";

export interface CreatedInviteLink {
  email: string;
  role: GroupRole;
  link: string;
}

export interface OnboardingActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Only set on successful group creation — see createGroupAction. */
  groupId?: string;
  inviteLinks?: CreatedInviteLink[];
}

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
    redirect("/sign-in?next=/onboarding/new");
  }

  const { majorToMinorUnits } = await import("@/lib/money");

  // A single atomic database call: the group, its owner membership, an
  // optional initial contribution plan, optional initial invitations, and
  // an audit log entry are all created in one transaction — see
  // public.create_group_with_setup() in
  // supabase/migrations/0002_phase2_auth_functions.sql. There is no
  // separate client-side insert that could leave a partially-created or
  // ownerless group.
  const { data, error } = await supabase.rpc("create_group_with_setup", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_description: parsed.data.description ?? null,
    p_country_code: parsed.data.countryCode,
    p_currency_code: parsed.data.currencyCode,
    p_contribution_frequency: parsed.data.contributionFrequency,
    p_contribution_type: parsed.data.contributionType,
    p_fixed_amount_minor_units:
      parsed.data.contributionType === "fixed" && parsed.data.fixedAmountMajorUnits
        ? majorToMinorUnits(parsed.data.fixedAmountMajorUnits, parsed.data.currencyCode)
        : null,
    p_financial_year_start_month: parsed.data.financialYearStartMonth,
    p_rules: parsed.data.rules ?? null,
    p_invites: parsed.data.invites,
  });

  const group = data?.[0];

  if (error || !group) {
    // create_group_with_setup() requires an approved organiser
    // application (see 0024_phase10_platform_authorisation.sql) — this
    // is the one error worth a more specific, actionable message than
    // the generic passthrough below.
    if (error?.message.includes("organiser application")) {
      return {
        status: "error",
        formError: `${error.message} Visit /apply-organiser to apply.`,
      };
    }
    return {
      status: "error",
      formError: error?.message ?? "Could not create the group. Please try again.",
    };
  }

  // New groups start pending_review (0024_phase10_platform_authorisation.sql)
  // and no longer send initial invitations at creation time — an
  // unapproved group must not be able to invite members. invite_links is
  // now always empty; kept in the return shape for compatibility with
  // GroupCreatedSummary, which already renders nothing when it's empty.
  const inviteLinks: CreatedInviteLink[] = (group.invite_links ?? []).map((invite) => ({
    email: invite.email,
    role: invite.role,
    link: `${getAppUrl()}/invitations/${invite.rawToken}`,
  }));

  return { status: "success", groupId: group.group_id, inviteLinks };
}

// Raw invitation tokens are 64 lowercase hex characters — extract one
// from a pasted link (e.g. https://.../invitations/<token>) or accept it
// as-is if the user pasted just the token.
const INVITATION_TOKEN_PATTERN = /[0-9a-f]{64}/i;

export async function joinGroupAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const raw = String(formData.get("invitationToken") ?? "");
  const extractedToken = (raw.match(INVITATION_TOKEN_PATTERN)?.[0] ?? raw).toLowerCase();

  const parsed = joinGroupSchema.safeParse({ invitationToken: extractedToken });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: { invitationToken: "Enter a valid invitation link or code." },
    };
  }

  redirect(`/invitations/${parsed.data.invitationToken}`);
}
