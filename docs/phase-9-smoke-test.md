# Phase 9 Manual Smoke Test

A manual, click-through verification of Phase 9 (production hardening:
security headers, rate limiting, scheduled jobs, provider-agnostic
email, CI, logging, deployment docs), run the same way the Phase 2-8
smoke tests were — see
[phase-8-smoke-test.md](./phase-8-smoke-test.md) for that precedent,
including its own methodology note about independently verifying
manual-walkthrough claims against real evidence rather than taking
chat/click confirmation alone — the same discipline applies here.

## Automated results

- `npx tsc --noEmit` — pass
- `npm run build` — pass
- `npx eslint .` — pass
- `npx vitest run` — 152/152 pass (no new pure-logic unit tests this
  phase — every Phase 9 change is either infra/config, a thin route
  handler, or a live-database-backed function, none of which fit this
  project's existing pure-function unit-test shape)
- `npm run test:security` — 128/128 pass (127 pre-existing + 1 new: an
  assertion in `tests/security/reports.test.ts` covering the
  statement-export audit-metadata fix, item 1). Needed the same
  cooldown-and-serialize retry as Phase 8's suite for the same
  documented Supabase-project auth rate limit, not a code issue — see
  "Cleanup" below for what that surfaced.
- A real, demonstrated bug was found and fixed during this same
  automated pass, before any manual testing began: the first
  implementation of item 4d's production environment validation
  (`src/lib/env.ts`) enforced required-in-production checks at
  module-load time, gated on `NODE_ENV === "production"`. `next build`
  always sets `NODE_ENV=production` internally regardless of actual
  deploy target, so this broke `npm run build` outright the moment it
  was tested — and would have broken the credential-free CI job too.
  Fixed by moving the enforcement into a standalone script
  (`scripts/check-production-env.mjs`, `npm run check:production-env`)
  that a deployment pipeline runs explicitly, rather than a check baked
  into a module every page imports. `env.ts` itself reverted to fully
  optional, matching its pre-existing pattern for every other variable.

## Manual walkthrough

**Not yet performed.** Unlike Phases 2–8, most of Phase 9's surface
area is infrastructure (CI, security headers, a scheduler endpoint) that
either has no interactive UI to click through, or genuinely needs a
deployed/staging environment to test meaningfully (the scheduler
endpoint, the CI workflow itself, production security headers against a
real domain). The rows below that *can* be checked against local dev
are listed as Pending; the ones that need a real deployment are marked
accordingly rather than left ambiguous.

| Step | Result |
|---|---|
| Security headers present on both a marketing page and a dashboard page (`curl -I`) | Pending |
| No CSP console violations across a full click-through (forms, selects, CSV downloads, the reports/notifications/audit pages) | Pending |
| Officer exports another member's statement; confirm the `report_export_generated` audit row now carries `metadata.subject_member_id` matching the selected member, not the officer (item 1 fix) | Pending |
| Invitation creation blocked after the configured rate-limit threshold, with a clear error message, not a silent failure | Pending |
| CSV export blocked after the configured rate-limit threshold (`429`) | Pending |
| Invitation-preview page still works normally under normal use (rate limiting fails closed there — confirm it isn't over-triggering on legitimate traffic) | Pending |
| Email still sends correctly after the `MAILTRAP_*` → `EMAIL_SMTP_*` rename (regression check — same Mailtrap sandbox, renamed variables) | Pending |
| `/api/scheduler/run` rejects a request with a missing/wrong bearer token (`401`) | Pending — needs `SCHEDULER_SECRET` configured locally first |
| `/api/scheduler/run` succeeds with the correct token once a scheduler Supabase Auth account exists, and calling it twice in a row shows the second call reporting zero *new* notifications for identical input (dedupe proof) | Deferred — needs the scheduler Supabase Auth account provisioned via the Dashboard first (not something this codebase can do) |
| `.github/workflows/ci.yml`'s `build-and-test` job passes on a real push/PR | Pending — needs the repo actually pushed to GitHub |
| `npm run check:production-env` fails clearly when a required Phase 9 var is missing, and passes once all are set | Pending — quick to check locally by unsetting one var and re-running |

## Cleanup

No new test accounts or groups are needed for the parts of this
walkthrough that don't require staging — the rate-limiting and
audit-metadata checks can reuse whatever throwaway account/group is
already on hand, deleted the same targeted way as every prior phase's
walkthrough once done.

Separately, this phase's own automated-test runs hit the same
Supabase-project auth rate limit documented in Phase 8's smoke test,
requiring a cooldown-and-serialize retry. That surfaced 27 fully
orphaned test accounts (no group memberships) left behind by earlier
interrupted runs — both from this phase's own retries and some
predating it. Verified zero group memberships across all 27 before
deleting; the two legitimate, persistent fixture-group owners
(`wc-calendar-flex-owner-*`, `wc-calendar-flexmin-owner-*`, used by
`tests/security/loan-eligibility-calendar.test.ts`) were confirmed
excluded and left untouched.

## Before Phase 10 (or before real users, whichever comes first)

1. **UK legal and regulatory review of the group lending model** — see
   `docs/legal-regulatory-review.md`. Still not done. Still the
   hardest, non-technical blocker on this list, and independent of
   everything else here being finished.
2. Hosting platform, email provider, monitoring vendor, and
   backup/PITR tier are all still open decisions (see
   `docs/phase-9-deployment-checklist.md`) — several other checklist
   items and the scheduler-trigger mechanism cascade from the hosting
   choice specifically.
3. The five scheduled-job RPCs don't yet check caller identity
   internally — a known, accepted, low-severity gap (each is
   idempotent and exposes only a count) documented in
   `docs/security-boundaries.md`'s Phase 9 section. Worth closing once
   the scheduler account exists to check against.
4. Edge/CDN-level rate limiting is not implemented — the current
   Postgres-backed limiter is right-sized for MVP traffic, not
   abuse-at-scale.
5. `npm audit` is wired into CI as warn-only, not build-failing — a
   deliberate starting point, worth tightening once there's a process
   for triaging findings.
