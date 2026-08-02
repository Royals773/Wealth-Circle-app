#!/usr/bin/env node
/**
 * Standalone predeploy check (Phase 9) — NOT run automatically by
 * `next build`, `npm run test`, or CI's build-and-test job. Deliberately
 * separate: `next build` always runs with NODE_ENV=production internally
 * regardless of deploy target, so baking this check into
 * src/lib/env.ts's module-load path would break every build/CI run
 * that doesn't have production secrets configured. Run this explicitly
 * as a deployment-pipeline step instead — see
 * docs/phase-9-deployment-checklist.md.
 *
 * Keep this list in sync with PRODUCTION_REQUIRED_KEYS in
 * src/lib/env.ts — duplicated here (rather than imported) because this
 * script runs standalone via plain Node, with no TypeScript/bundler
 * step, and env.ts's schema module isn't meant to be loaded outside
 * the Next.js app.
 */
const REQUIRED_KEYS = [
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
];

const missing = REQUIRED_KEYS.filter((key) => !process.env[key] || process.env[key] === "");

const errors = [];
if (missing.length > 0) {
  errors.push(`Missing required production environment variables: ${missing.join(", ")}`);
}
if (process.env.SCHEDULER_SECRET && process.env.SCHEDULER_SECRET.length < 32) {
  errors.push("SCHEDULER_SECRET must be at least 32 characters in production");
}
if (process.env.SUPABASE_SECRET_KEY) {
  errors.push(
    "SUPABASE_SECRET_KEY is set — it must never be present in a deployed app's runtime environment; " +
      "it is only ever needed by tests/security/*.test.ts. See docs/security-boundaries.md.",
  );
}

if (errors.length > 0) {
  console.error("Production environment check failed:\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}

console.log("Production environment check passed.");
