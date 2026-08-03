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

A live Vercel staging deployment now exists (see
`docs/phase-9-vercel-staging-checklist.md` for the full setup record),
so several rows below moved from "needs a real deployment" to
genuinely tested — against either that staging deployment or local dev
with direct browser automation, not just chat/click confirmation.

### A critical bug found and fixed during this walkthrough

**The static CSP broke React hydration app-wide.** `next.config.ts`'s
`script-src` originally omitted `'unsafe-inline'` (only `style-src` had
it), on the incorrect assumption that only app-authored inline scripts
mattered. Confirmed via direct, automated browser testing (Playwright
driving a real Chromium instance against local dev, not manual
click-through) that Next.js's own framework bootstrap — RSC payload
streaming, hydration data — injects inline `<script>` tags on every
page load regardless of app code, and the browser was silently
blocking every one of them. The practical symptom: **every interactive
client component stopped responding to any interaction** — first
noticed as the sign-up form's terms checkbox appearing completely
unresponsive on the deployed staging site. `data-state` on the
checkbox's underlying element never changed from `"unchecked"` after a
real, automated click, with zero console-visible explanation until the
CSP violation errors were captured directly (`console --errors`
equivalent via Playwright's console listener). `next build` and `next
lint` both stayed green throughout — CSP is a runtime browser
enforcement, not a build-time check, so nothing in the existing
automated gate could have caught this.

A second, smaller, genuinely separate bug was found and fixed in the
same session, before the CSP root cause was identified: the
shadcn-generated `Checkbox`/`Switch`/`RadioGroup` components styled
themselves with a `data-checked:` Tailwind variant, which only matches
a literal `data-checked` attribute — but Radix sets `data-state`, never
that. This was a real, independent visual-styling bug (confirmed by
reading `@radix-ui/react-checkbox`'s actual source), fixed by switching
to `data-[state=checked]:`/`data-[state=unchecked]:`. Both fixes were
necessary together: the CSP fix restored the click handler entirely;
the Tailwind fix ensures the checked state is visually distinguishable
once it fires.

Both fixes are commits `10ee175` (Tailwind variant) and the `next.config.ts`
`script-src` correction (this doc's own commit) on the `staging` branch,
verified via direct Playwright automation against local dev
(`data-state` and `aria-checked` both correctly toggle "unchecked" →
"checked" on click, computed background/border colors both change) and
redeployed to the live staging URL via `vercel --prod` after the Vercel
git-push-triggers-a-build integration was found to not be wired up
correctly (a separate, still-open issue — see "Before Phase 10" below).

### A genuinely separate setup gap: Supabase Auth emails need their own SMTP config

Not a code bug — a real, non-obvious operational requirement for any
**new** Supabase project. Supabase's own Auth service (not this app's
`EMAIL_SMTP_*`/`sendNotificationEmail()` pipeline) sends signup
confirmation and password-reset emails using its own, separately
configured mail sending. A fresh project defaults to Supabase's shared
testing sender, which has a very low built-in rate limit — the first
few real sign-up attempts against the new staging project failed with
`error.code: "over_email_send_rate_limit"` (confirmed via a direct
`supabase.auth.signUp()` diagnostic call, not just observing the UI).
Configuring custom SMTP (Authentication → Emails → SMTP Settings, same
Mailtrap sandbox credentials as this app's own `EMAIL_SMTP_*`) resolved
the rate limit but initially traded it for an opaque `{"message": "{}",
"status": 500, "name": "AuthRetryableFetchError"}` — GoTrue's generic
wrapper around any downstream SMTP failure, in this case simply a
mistyped SMTP password in the Supabase dashboard field, unrelated to
anything in this codebase. Once corrected, the full sign-up → confirm →
sign-in round trip was verified working end-to-end, cross-checked
directly against `auth.users.email_confirmed_at` rather than UI
observation alone. **Any future new Supabase project (a real production
project, most obviously) will need this same custom-SMTP configuration
before real sign-ups can work at any meaningful volume** — worth adding
explicitly to `docs/phase-9-deployment-checklist.md`'s production
section, not just discovered ad hoc again.

| Step | Result |
|---|---|
| Security headers present on a public page (`curl -I` against the live staging URL) | ✅ Confirmed — full header set present (CSP, HSTS, X-Frame-Options, etc.) |
| Security headers present on an authenticated dashboard page | Pending — not yet checked against a real signed-in session |
| No CSP console violations across a full click-through | Partially confirmed, and non-trivially so — see the bug account above. Verified via direct browser automation for the sign-up page specifically (now clean, only a benign dev-mode-only React `eval()` warning that's expected and production-safe per Next's own docs). The root cause was a global `script-src` header affecting every page, so it should now be resolved everywhere, but a fuller click-through of authenticated dashboard pages hasn't been separately automated yet |
| Officer exports another member's statement; confirm the `report_export_generated` audit row now carries `metadata.subject_member_id` matching the selected member, not the officer (item 1 fix) | Pending |
| Invitation creation blocked after the configured rate-limit threshold, with a clear error message, not a silent failure | Pending |
| CSV export blocked after the configured rate-limit threshold (`429`) | Pending |
| Invitation-preview page still works normally under normal use (rate limiting fails closed there — confirm it isn't over-triggering on legitimate traffic) | Pending |
| Sign-up → Mailtrap confirmation email → `/auth/confirm` round trip works end-to-end on the staging deployment | ✅ Confirmed — full round trip (sign-up, click-to-confirm, sign-in) verified working, and independently checked against the staging project's `auth.users` table (`email_confirmed_at` correctly set) rather than relying on UI observation alone. See the SMTP note below for what it took to get here |
| Email still sends correctly after the `MAILTRAP_*` → `EMAIL_SMTP_*` rename (regression check) | ✅ Confirmed — this app's own notification emails (`EMAIL_SMTP_*`) were never the issue; see below for the separate, real gap this surfaced |
| `/api/scheduler/run` rejects a request with a missing/wrong bearer token (`401`) | Pending — needs `SCHEDULER_SECRET` configured on staging first |
| `/api/scheduler/run` succeeds with the correct token once a scheduler Supabase Auth account exists, and calling it twice in a row shows the second call reporting zero *new* notifications for identical input (dedupe proof) | Deferred — needs the scheduler Supabase Auth account provisioned via the staging project's Dashboard first |
| `.github/workflows/ci.yml`'s `build-and-test` job passes on a real push/PR | Repo is now pushed to GitHub (`Royals773/Wealth-Circle-app`, both `main` and `staging` pushed) — actual workflow-run status not yet confirmed (no `gh` CLI available in this environment, repo is private) |
| `npm run check:production-env` fails clearly when a required Phase 9 var is missing, and passes once all are set | ✅ Confirmed — tested all three cases (nothing set, `SUPABASE_SECRET_KEY` set as a leak check, everything correctly set) with a clean environment via `env -i` |
| Migrations `0001`–`0017` apply cleanly in order to a brand-new Supabase project, and RLS behaves identically to the existing project | ✅ Confirmed — see `docs/phase-9-vercel-staging-checklist.md`; 128/128 live security tests pass against the new staging project |

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
2. **Hosting is now decided (Vercel)** and a private staging deployment
   exists — see `docs/phase-9-vercel-staging-checklist.md`. Email
   provider, monitoring vendor, and backup/PITR tier remain open
   decisions (see `docs/phase-9-deployment-checklist.md`).
3. **Vercel's GitHub-push-triggers-a-build integration is not working**
   — pushing to `staging` did not trigger an automatic deployment
   during this session, even after disconnecting and reconnecting the
   Git integration. Worked around via the Vercel CLI
   (`vercel --prod`) directly for this session's fixes, but the root
   cause (likely a GitHub App repository-access permission gap) hasn't
   been diagnosed or fixed — worth investigating before relying on
   push-to-deploy for real work.
4. The five scheduled-job RPCs don't yet check caller identity
   internally — a known, accepted, low-severity gap (each is
   idempotent and exposes only a count) documented in
   `docs/security-boundaries.md`'s Phase 9 section. Worth closing once
   the scheduler account exists to check against.
5. Edge/CDN-level rate limiting is not implemented — the current
   Postgres-backed limiter is right-sized for MVP traffic, not
   abuse-at-scale.
6. `npm audit` is wired into CI as warn-only, not build-failing — a
   deliberate starting point, worth tightening once there's a process
   for triaging findings.
