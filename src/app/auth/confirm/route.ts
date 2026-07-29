import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/safe-redirect";

/**
 * Handles Supabase's token_hash-based email verification links — the
 * pattern Supabase's default email templates use for signup confirmation,
 * password recovery and email change, specifically because it survives
 * email-client link prefetching (which would otherwise silently consume a
 * single-use PKCE `code` before the real recipient clicks it).
 *
 * Configure this as the confirmation URL in the Supabase Dashboard's email
 * templates: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const requestedNext = searchParams.get("next");

  const defaultNext = type === "recovery" ? "/reset-password" : "/onboarding";
  const next = getSafeRedirect(requestedNext, defaultNext);

  if (!isSupabaseConfigured || !tokenHash || !type) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid_link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    const destination = type === "recovery" ? "/forgot-password" : "/sign-in";
    return NextResponse.redirect(`${origin}${destination}?error=expired_link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
