import { z } from "zod";

/**
 * Public pages must render without Supabase credentials, so these are
 * validated as optional strings here. Code that actually needs Supabase
 * (see src/lib/supabase/*) checks for their presence at the point of use
 * and fails with a clear error rather than at module load time.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  // Supabase's publishable key (formerly "anon key"). Safe to ship to the
  // browser — Row Level Security is what actually protects data.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional().or(z.literal("")),
  NEXT_PUBLIC_APP_URL: z.string().url().optional().or(z.literal("")),
  // Server-only. Never referenced from client components or exposed via
  // NEXT_PUBLIC_*. Not required or used anywhere in Phase 1 or Phase 2 —
  // reserved for a future trusted server-side process that genuinely
  // needs to bypass Row Level Security (e.g. a scheduled job).
  SUPABASE_SECRET_KEY: z.string().min(1).optional().or(z.literal("")),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
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
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export function getAppUrl(): string {
  return env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
