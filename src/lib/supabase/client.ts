"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Browser Supabase client. Uses only the public URL and publishable key,
 * both of which are safe to ship to the client. Row Level Security is what
 * actually protects data — this client never carries elevated privileges.
 * Uses the PKCE auth flow (the @supabase/ssr default), which is required
 * for the server-side code-exchange callback in src/app/auth/callback.
 */
export function createClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your environment before " +
        "calling createClient().",
    );
  }

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    { auth: { flowType: "pkce" } },
  );
}
