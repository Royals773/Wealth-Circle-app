import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSafeRedirect } from "@/lib/safe-redirect";

/**
 * PKCE code-exchange callback. Not used by Supabase's default email
 * templates today (see src/app/auth/confirm/route.ts for those), but kept
 * as the standard entry point for any auth method that redirects back
 * with a `?code=` parameter — third-party OAuth providers, if ever added.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = getSafeRedirect(searchParams.get("next"), "/onboarding");

  if (!isSupabaseConfigured || !code) {
    return NextResponse.redirect(`${origin}/sign-in?error=invalid_link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=expired_link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
