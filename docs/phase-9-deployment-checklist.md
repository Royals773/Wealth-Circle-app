# Staging and Production Deployment Checklists (Phase 9)

Vendor-agnostic on purpose — hosting platform, email provider, and
monitoring vendor are all still open decisions (see
`docs/mvp-roadmap.md`'s Phase 9 entry and the Phase 9 planning
discussion). Fill in the blank rows once those are chosen and approved;
don't invent vendor-specific steps ahead of that.

## Before any deploy (staging or production)

- [ ] `npm run typecheck && npm run lint && npm run build && npm run test` all pass locally and in CI.
- [ ] All pending migrations in `supabase/migrations/` applied to the target Supabase project, in numeric order, via the Supabase SQL editor or CLI (this repo has no automated migration-apply step — see "How migrations get applied" below).
- [ ] `npm run check:production-env` passes against the target environment's variables. Deliberately a standalone script (`scripts/check-production-env.mjs`), not a check baked into `src/lib/env.ts`'s module-load path — `next build` always runs with `NODE_ENV=production` internally regardless of deploy target, so a build-time check would break every build and CI run that doesn't have production secrets configured, including the credential-free CI job.
- [ ] **`SUPABASE_SECRET_KEY` is confirmed *not* set anywhere in the deployed app's runtime environment.** It is only ever needed by `tests/security/*.test.ts`, never by application code — see `docs/security-boundaries.md`'s Credential Handling section. Setting it in a deployed app's environment would be a live violation of this project's core security boundary, not a convenience.
- [ ] `EMAIL_SMTP_*` points at the intended provider for this environment (Mailtrap for anything that isn't real production; a real transactional provider for production — never the reverse).
- [ ] `SCHEDULER_SECRET` is a freshly generated random value (≥32 chars, per `env.ts`'s production check), not reused across environments.

## How migrations get applied

There is no `supabase db push`-equivalent wired into this project's
tooling — every migration through Phase 9 has been applied by hand via
the Supabase Dashboard's SQL editor (or the Supabase CLI, if the person
deploying has it installed and linked). This checklist assumes that
remains true; if CI/CD-driven migration application is wanted later,
that's a new, separate decision (likely via the Supabase CLI in a
GitHub Actions step), not assumed here.

## Staging

- [ ] Staging points at its **own, separate Supabase project** — never shares a project with production, even temporarily.
- [ ] Staging's Supabase project may be the same one used by CI's `security-tests` job (see `.github/workflows/ci.yml`), or a third separate one — decide once and document the choice here once made.
- [ ] `SCHEDULER_SECRET`/`SCHEDULER_SUPABASE_EMAIL`/`SCHEDULER_SUPABASE_PASSWORD` point at a staging-only scheduler account (see `docs/security-boundaries.md`'s "Scheduled jobs" section for what that account needs: an ordinary Supabase Auth user with no group memberships).
- [ ] Run the full `docs/phase-9-smoke-test.md` walkthrough against staging before ever pointing production traffic anywhere.

## Production

- [ ] Hosting platform decided and provisioned (**open decision** — not made by this document).
- [ ] Production domain/DNS configured, including SPF/DKIM/DMARC for the email provider's sending domain (**open decision**).
- [ ] `NEXT_PUBLIC_APP_URL` matches the real production domain exactly (used to build auth redirect and notification action links).
- [ ] Supabase project's Auth → URL Configuration → Redirect URLs includes the production domain's `/auth/callback` and `/auth/confirm`.
- [ ] Email provider (item 3) is using real production sender credentials, confirmed via one real end-to-end test send in staging first — never test deliverability against production user addresses.
- [ ] Scheduler trigger (item 2) points at the production URL — only after the staging smoke test has passed, not before.
- [ ] Security headers/CSP (`next.config.ts`) sanity-checked against the real production domain: load the app in a browser, check the console for CSP violations. `'self'` directives are domain-relative, so this should be a non-issue, but verify rather than assume.
- [ ] Monitoring/error-reporting DSN set, once a vendor is chosen and approved (**open decision** — `src/lib/logger.ts`'s `reportError()` hook is a no-op until then).
- [ ] Database backup/PITR tier confirmed active for the production Supabase project — see `docs/phase-9-backup-recovery.md` (**cost decision, open**).
- [ ] **UK legal/regulatory review status checked** — see `docs/legal-regulatory-review.md`. Lending functionality (loan application/approval/disbursement/repayment) must not go live for real users until that review is resolved, independent of every technical item on this checklist.

## Rollback plan

No `down.sql` mechanism exists anywhere in this project's migration
history — every correction to date (`0016` fixing `0015`) has been a
new forward migration, not a revert. If a deployed Phase 9+ change needs
undoing, the established pattern is: write a new corrective migration
or a new commit reverting the application-code change, then redeploy —
not a rollback script invented under incident pressure. See
`docs/phase-9-backup-recovery.md` for the database-restore path if a
rollback needs to go further than schema/code (i.e. actual data
corruption, not just a bad code change).

## Post-deploy smoke test

Run `docs/phase-9-smoke-test.md` (a manual, click-through walkthrough
following the same shape as Phases 2–8's smoke-test docs) against the
newly deployed environment before considering the deploy complete.
