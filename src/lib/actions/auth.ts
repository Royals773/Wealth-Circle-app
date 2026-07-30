"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getAppUrl, isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/safe-redirect";
import {
  forgotPasswordSchema,
  registerForInvitationSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validations/auth";

export interface AuthActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
}

const NOT_CONFIGURED_MESSAGE =
  "This isn't available in this preview yet — Supabase credentials haven't been " +
  "configured. See .env.example for the variables an operator needs to add.";

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    acceptTerms: formData.get("acceptTerms") === "on",
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      // Becomes {{ .RedirectTo }} in the "Confirm signup" email template —
      // see docs/architecture.md for why that template must use
      // token_hash + /auth/confirm rather than the default
      // {{ .ConfirmationURL }}.
      emailRedirectTo: `${getAppUrl()}/onboarding`,
    },
  });

  // Deliberately does not distinguish "email already registered" from any
  // other outcome — both look identical to the caller, so this form can't
  // be used to enumerate which email addresses already have accounts.
  if (error && error.code !== "user_already_exists" && error.code !== "email_exists") {
    if (error.code === "weak_password") {
      return {
        status: "error",
        fieldErrors: { password: "Choose a stronger password." },
      };
    }
    return {
      status: "error",
      formError: "We couldn't create your account. Please try again in a moment.",
    };
  }

  redirect("/verify-email");
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { status: "error", formError: "Incorrect email or password." };
  }

  // /dashboard itself resolves to the member's first group, or to
  // onboarding if they don't belong to one yet — see
  // src/app/(dashboard)/dashboard/page.tsx.
  const next = getSafeRedirect(String(formData.get("next") ?? ""), "/dashboard");
  redirect(next);
}

export async function forgotPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getAppUrl()}/reset-password`,
  });

  // Always report success, whether or not the address is registered, so
  // the form can't be used to enumerate accounts.
  return { status: "success" };
}

export async function resetPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
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
    return {
      status: "error",
      formError: "This link is invalid or has expired. Request a new password reset email.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    }
    if (error.code === "same_password") {
      return {
        status: "error",
        formError: "That's your current password — choose a different one.",
      };
    }
    return {
      status: "error",
      formError: "We couldn't reset your password. Please try again.",
    };
  }

  redirect("/sign-in");
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}

/**
 * Registers a brand-new account for someone who followed an invitation
 * link but doesn't have one yet. This only creates the Supabase Auth
 * user — it does NOT join the group. Supabase requires the email to be
 * verified before a session exists, so group membership is granted
 * afterwards, once the user returns (now authenticated) to the same
 * invitation page and confirms via confirmAcceptInvitationAction — see
 * src/lib/actions/invitations.ts.
 */
export async function registerForInvitationAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = String(formData.get("token") ?? "");

  const parsed = registerForInvitationSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    acceptTerms: formData.get("acceptTerms") === "on",
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${getAppUrl()}/invitations/${token}`,
    },
  });

  if (error && error.code !== "user_already_exists" && error.code !== "email_exists") {
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: "Choose a stronger password." } };
    }
    return {
      status: "error",
      formError: "We couldn't create your account. Please try again in a moment.",
    };
  }

  return { status: "success" };
}

/**
 * Performs the actual email/recovery-link verification. Deliberately
 * separated from the page that renders — see src/app/auth/confirm/page.tsx —
 * so that loading the link (a GET request, which an email provider's
 * link-safety scanner may issue automatically before the recipient ever
 * clicks) never by itself consumes the single-use token. Only this
 * explicit, user-initiated action does.
 */
export async function confirmEmailAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const tokenHash = String(formData.get("tokenHash") ?? "");
  const type = String(formData.get("type") ?? "") as EmailOtpType;
  const next = getSafeRedirect(
    String(formData.get("next") ?? ""),
    type === "recovery" ? "/reset-password" : "/onboarding",
  );

  if (!tokenHash || !type) {
    return { status: "error", formError: "This link is invalid." };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return {
      status: "error",
      formError: "This link is invalid or has expired. Please request a new one.",
    };
  }

  redirect(next);
}
