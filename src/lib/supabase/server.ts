import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, isSupabaseConfigured } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Server-side Supabase client for use in Server Components, Server Actions
 * and Route Handlers. Reads and writes the session via cookies so RLS
 * policies apply using the signed-in user's identity — this client never
 * uses an elevated key. Uses the PKCE auth flow, matching the browser
 * client and the /auth/callback code-exchange route.
 */
export async function createClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your environment before " +
        "calling createClient().",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL as string,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    {
      auth: { flowType: "pkce" },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that cannot set cookies.
            // Session refresh is instead handled by src/proxy.ts.
          }
        },
      },
    },
  );
}
