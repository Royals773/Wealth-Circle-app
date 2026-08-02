# Vercel Staging Deployment Checklist (Phase 9)

Hosting decision: **Vercel** (confirmed by product owner). This
checklist covers a **private staging deployment on a Vercel-generated
URL only** — no custom domain, not for real users. See
`docs/phase-9-deployment-checklist.md` for the broader (vendor-agnostic)
production checklist this supplements.

**Nothing in this checklist has been executed except where marked
done.** Every other step is pending explicit, one-at-a-time approval
before any Vercel project, environment variable, Supabase setting, or
deployment is created or changed.

## Decisions (confirmed by product owner)

1. **Supabase project for staging: a completely separate, brand-new
   project.** Do not reuse the existing WealthCircle Supabase project.
   Do not use the unrelated "Courage Website" Supabase project under
   any circumstances.
2. **Git branch: `staging`**, additionally set as Vercel's **Production
   Branch** (Project Settings → Git) instead of the repo's default
   `main` — decided during setup so the staging deployment gets a
   stable URL across redeploys (rather than a fresh Preview URL each
   time) and so its environment variables use Vercel's Production
   scope. `main` no longer auto-deploys as a result. No custom domain
   is attached regardless — see "What NOT to do yet" below.
3. **Scheduler endpoint: tested in staging only**, using synthetic test
   data and the Mailtrap sandbox. It must never send email to a real
   user — Mailtrap is a closed sandbox by construction, and no real
   member/financial data will exist in the staging project at all (see
   Part 0 below), so there is nothing for it to leak even in principle.

## Part 0 — New Supabase staging project (do this before any Vercel step)

0. Create a brand-new Supabase project, clearly named to avoid any
   confusion with the existing WealthCircle project or the unrelated
   Courage Website project (e.g. "WealthCircle Staging").
1. Apply migrations `0001` through `0017`, **in numeric order**, via
   that new project's SQL Editor — the same manual process used for
   every migration in this project's history (there is no automated
   migration-apply tooling wired in). Each file lives in
   `supabase/migrations/`.
2. After all 17 are applied, run the preflight/postflight-style
   verification queries used for migration `0017` (table/function
   existence, grants) generalized across the full set — see "Verify
   RLS and security tests" below for the fuller check.
3. Populate a fresh `.env.staging.local` (or equivalent, gitignored —
   never `.env.local`, which stays pointed at the existing dev project)
   with this new project's `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and its own
   `SUPABASE_SECRET_KEY` (used only locally, only for running
   `tests/security/*.test.ts` against the staging project — never
   entered into Vercel, per this project's standing rule).
4. Run `npm run test:security` locally against the new project (by
   pointing env vars at it) to independently verify RLS before ever
   connecting Vercel — not just "the migrations ran without SQL
   errors," but that Row Level Security actually behaves as every
   other environment's copy does.
5. Confirm the existing WealthCircle project is completely unaffected
   — this is a brand-new project, so there's no shared state to check,
   but worth a quick sanity read-only query against the *existing*
   project confirming its row counts are unchanged from before this
   work started, since that's the one true invariant that must hold.
6. Do not add any real members, groups, or financial records to the
   staging project at any point — only synthetic/throwaway test data,
   same policy as every phase's own smoke testing.

## Part A. Vercel project setup

7. Create the Vercel project, linked to this repository, tracking the
   `staging` branch.
8. **Do not add a custom domain.** Use the Vercel-generated
   `*.vercel.app` URL only.
9. Consider enabling Vercel's **Deployment Protection** (password
   protection or Vercel Authentication) on Preview deployments — the
   `*.vercel.app` URL is guessable/discoverable, not genuinely private
   on its own. Availability depends on your Vercel plan tier.

## Part B. Environment variables (Vercel dashboard → Project → Settings → Environment Variables)

10. Set the following for the **Production** environment scope (since
    `staging` is now Vercel's Production Branch — see decision #2 —
    these are the vars that apply to the staging deployment itself):
    - `NEXT_PUBLIC_SUPABASE_URL` — the **new staging project's** URL
    - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the **new staging
      project's** publishable key
    - `NEXT_PUBLIC_APP_URL` — the stable staging URL from decision #2,
      **with the `https://` scheme**, once known
    - `EMAIL_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM_EMAIL` —
      Mailtrap sandbox values
    - `SCHEDULER_SECRET` / `SCHEDULER_SUPABASE_EMAIL` / `_PASSWORD` —
      for the dedicated scheduler account created in the **new staging
      project** (Part C, step 13)
    - **Do not set `SUPABASE_SECRET_KEY` anywhere in Vercel — not for
      staging, not ever.**

## Part C. Supabase configuration (on the **new staging project**, Dashboard → Authentication → URL Configuration)

11. Add `https://<staging-url>/**` to **Redirect URLs**.
12. Leave **Site URL** as whatever the new project defaults to, unless
    a specific need arises.
13. Create the dedicated scheduler Supabase Auth account in the
    **staging project** (matching the credentials set in Part B, step
    10), confirm it has **no group memberships**.

## Part D. Deploy and verify

14. Push the `staging` branch, let Vercel build and deploy.
15. Confirm the build succeeds on Vercel (already proven to succeed
    locally with zero env vars against a clean `npm ci` — see the Phase
    9 conversation record — so a Vercel-side failure here would point
    at something environment-specific, not the code itself).
16. Load the staging URL, confirm the marketing/public pages render.
17. Sign up a throwaway synthetic test account, confirm the
    confirmation email round-trip works end-to-end (Mailtrap → click
    confirm → `/auth/confirm` → redirected correctly) — the real test
    of Part C step 11's Redirect URL change.
18. Manually trigger `/api/scheduler/run` once:
    `curl -X POST -H "Authorization: Bearer <SCHEDULER_SECRET>" https://<staging-url>/api/scheduler/run`
    — confirm a `200` with a sane JSON summary, and separately confirm
    a request with no/wrong header gets `401`. Only synthetic test
    data should exist in the staging project at this point, so nothing
    it touches can be a real user.
19. Run through `docs/phase-9-smoke-test.md`'s manual walkthrough
    against the staging URL (security headers, CSV export rate
    limiting, etc.).

## What NOT to do yet

- No custom domain, even though `staging` is technically Vercel's
  Production Branch now — that labeling is about env var scope and URL
  stability, not an intent to go live for real users.
- No Vercel Cron configuration yet. Now that `staging` is the
  Production Branch, Vercel Cron *could* technically fire against it —
  but the scheduler route only exports `POST` today, not the `GET`
  Vercel Cron requires, so it still wouldn't work without a code change
  first, and none is planned as part of this checklist.
- No real email provider — Mailtrap only.
- No real users, real groups, or real financial records in the staging
  project, ever.
- No changes to the existing WealthCircle Supabase project.
- No changes to the unrelated Courage Website Supabase project.
