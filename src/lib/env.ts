import { z } from "zod";

/**
 * Public pages must render without Supabase credentials, so these are
 * validated as optional strings here. Code that actually needs Supabase
 * (see src/lib/supabase/*) checks for their presence at the point of use
 * and fails with a clear error rather than at module load time.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional().or(z.literal("")),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional().or(z.literal("")),
  // Server-only. Never referenced from client components or exposed via
  // NEXT_PUBLIC_*. Only read inside trusted server contexts (e.g. a future
  // admin task runner), never inside code shipped to the browser.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional().or(z.literal("")),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();

export const isSupabaseConfigured = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export function getSiteUrl(): string {
  return env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}
