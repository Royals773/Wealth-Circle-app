"use server";

import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  acceptInvitationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validations/auth";

export interface AuthActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
}

export const initialAuthActionState: AuthActionState = { status: "idle" };

const NOT_CONFIGURED_MESSAGE =
  "Sign-in isn't available in this preview yet — Supabase credentials haven't been " +
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
    options: { data: { full_name: parsed.data.fullName } },
  });

  if (error) {
    return { status: "error", formError: error.message };
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

  redirect("/dashboard");
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
  await supabase.auth.resetPasswordForEmail(parsed.data.email);

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
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { status: "error", formError: error.message };
  }

  redirect("/sign-in");
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/sign-in");
}

export async function acceptInvitationAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = acceptInvitationSchema.safeParse({
    token: formData.get("token"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  // Phase 2 will look up the group_invitations row by token, create the
  // account, and insert the corresponding group_memberships row inside a
  // single transaction (via an RPC function) so a partial signup can never
  // leave an accepted invitation without a membership.
  return {
    status: "error",
    formError: "Accepting invitations will be enabled once group onboarding ships.",
  };
}
