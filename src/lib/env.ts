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
  // Generic SMTP relay — Mailtrap's sandbox during development, a real
  // transactional provider (Postmark/SES/SendGrid/etc.) in production;
  // the app is provider-agnostic since nodemailer speaks plain SMTP (see
  // src/lib/email/mailer.ts). All optional: notification emails are a
  // safe no-op when unset, the same graceful-degradation pattern as
  // isSupabaseConfigured — the in-app notification always exists
  // regardless of whether email is configured or delivery succeeds.
  EMAIL_SMTP_HOST: z.string().min(1).optional().or(z.literal("")),
  EMAIL_SMTP_PORT: z.coerce.number().int().positive().optional(),
  EMAIL_SMTP_USER: z.string().min(1).optional().or(z.literal("")),
  EMAIL_SMTP_PASS: z.string().min(1).optional().or(z.literal("")),
  EMAIL_SMTP_FROM_EMAIL: z.string().email().optional().or(z.literal("")),
  // Phase 9: authenticates the scheduled-job trigger endpoint
  // (src/app/api/scheduler/run/route.ts). Distinct from and no more
  // powerful than SUPABASE_SECRET_KEY — it gates a machine-to-machine
  // HTTP call, not database access; the endpoint itself signs in as an
  // ordinary, unprivileged Supabase Auth account to do its work. See
  // docs/security-boundaries.md.
  SCHEDULER_SECRET: z.string().min(1).optional().or(z.literal("")),
  SCHEDULER_SUPABASE_EMAIL: z.string().email().optional().or(z.literal("")),
  SCHEDULER_SUPABASE_PASSWORD: z.string().min(1).optional().or(z.literal("")),
});

type Env = z.infer<typeof envSchema>;

/**
 * Required for a real production deployment, but deliberately NOT
 * enforced here at module-load time: `next build` always runs with
 * NODE_ENV=production internally regardless of deploy target (it's not
 * a reliable signal for "this is a live deployment"), so throwing here
 * would break every build and CI run that doesn't have production
 * secrets configured — including the credential-free CI job in
 * .github/workflows/ci.yml. Enforced instead by
 * scripts/check-production-env.mjs, a standalone predeploy check (see
 * docs/phase-9-deployment-checklist.md) that a deployment pipeline runs
 * explicitly, separate from `next build`.
 */
export const PRODUCTION_REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "EMAIL_SMTP_HOST",
  "EMAIL_SMTP_PORT",
  "EMAIL_SMTP_USER",
  "EMAIL_SMTP_PASS",
  "EMAIL_SMTP_FROM_EMAIL",
  "SCHEDULER_SECRET",
  "SCHEDULER_SUPABASE_EMAIL",
  "SCHEDULER_SUPABASE_PASSWORD",
] as const satisfies readonly (keyof Env)[];

function loadEnv(): Env {
  const raw = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    EMAIL_SMTP_HOST: process.env.EMAIL_SMTP_HOST,
    EMAIL_SMTP_PORT: process.env.EMAIL_SMTP_PORT,
    EMAIL_SMTP_USER: process.env.EMAIL_SMTP_USER,
    EMAIL_SMTP_PASS: process.env.EMAIL_SMTP_PASS,
    EMAIL_SMTP_FROM_EMAIL: process.env.EMAIL_SMTP_FROM_EMAIL,
    SCHEDULER_SECRET: process.env.SCHEDULER_SECRET,
    SCHEDULER_SUPABASE_EMAIL: process.env.SCHEDULER_SUPABASE_EMAIL,
    SCHEDULER_SUPABASE_PASSWORD: process.env.SCHEDULER_SUPABASE_PASSWORD,
  };

  const parsed = envSchema.safeParse(raw);

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
