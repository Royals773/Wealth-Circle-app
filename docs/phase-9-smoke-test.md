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
- `npx vitest run` — 157/157 pass (152 pre-existing + 5 new: the
  scheduler endpoint's bearer-token gate, `src/app/api/scheduler/run/route.test.ts`
  — see "Scheduler email capability fix" below for the rest of that
  work, which needed a live database and so lives in `tests/security`
  instead)
- `npm run test:security` — 136/136 pass (128 pre-existing + 8 new,
  covering the scheduler email capability fix). Needed the same
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

### Scheduler dedupe proof: a real overdue scenario, and a genuine functional gap it surfaced

Superseding the earlier "trivial, zero-data" dedupe check. A temporary,
clearly-labelled `contribution_plans` row ("PHASE9-TEST-OVERDUE-PLAN")
was created on the real "Susu" staging group — weekly frequency,
`start_date` chosen so the period containing the member's actual
`joined_at` had already ended by the day of the test — deliberately
constructed from the exact rules in
`member_has_overdue_contributions()` (`supabase/migrations/0009_exact_overdue_contribution_eligibility.sql`)
rather than guessed, and pre-verified true via a direct RPC call before
touching the scheduler at all.

**Run 1** (`POST /api/scheduler/run` with the correct bearer token)
returned `overdueContributions: 2` and created exactly one
`contribution_overdue` notification for the test member (dedupe key
`overdue_contribution:<member>:<group>:2026-08-04`) — plus one for the
group's owner, correctly and expectedly, since a contribution plan
applies to every member of the group, not just the one this test
targeted, and the owner also had no verified contribution for that
period. **Run 2**, immediately after with no data changes, returned
`overdueContributions: 0` and created zero new rows — both original
notification rows unchanged (same `id`, same `created_at`). Dedupe
confirmed at the database level exactly as designed, via
`create_notification()`'s `unique (recipient_id, dedupe_key) where
dedupe_key is not null` index.

**The real gap:** both runs also returned `emailsSent: 0, emailsFailed:
0` — not because sending failed, but because `claim_pending_notification_emails()`
never found anything to claim. Reading its definition (`0015_phase8_reports_notifications_audit.sql`)
shows why: it only claims a notification if the recipient shares a
group with the *caller*, a narrowing rule written for the normal
opportunistic flush path (an ordinary signed-in group member
triggering it from their own dashboard). The dedicated scheduler
account is deliberately memberless — a security choice, so it carries
no group access of its own — which means it can never satisfy that
"shares a group" condition for *any* group-scoped notification. In its
current form, the scheduled job can create in-app notifications
correctly (proven above) but **can never flush their emails** for
anything group-scoped, which is nearly everything the five reminder
functions produce. This is a real, previously-undiscovered functional
gap, not a test artifact — worth its own fix (most likely: a
scheduler-aware exception in the claim query's narrowing condition,
analogous to the existing `n2.group_id is null` account-level
carve-out) before relying on the scheduler for real reminder emails.
Recorded in "Before Phase 10" below rather than fixed inline, since it
touches the same security-boundary tradeoff the memberless-scheduler
design was deliberately built around.

**A mid-test credential-exposure incident, safely contained:** the
scheduler test account's password was regenerated to fix an unrelated
sign-in mismatch, and was briefly printed to a local terminal (never
into this chat) before being recognized as compromised-by-exposure and
rotated again immediately. The second rotation was done with the new
value never appearing in any command text, tool output, log, or file
readable outside the operation itself: generated inside a script that
never logs it, written directly into `.env.staging.local` (preserving
every other variable) and into a private scratchpad file outside the
repository, piped into `vercel env update SCHEDULER_SUPABASE_PASSWORD
production` via stdin redirection (`< file`, never `--value`), then the
scratchpad file and the one-off script were deleted immediately after.
`SCHEDULER_SECRET` (a separate credential) was left untouched
throughout. The staging deployment was redeployed and its protected
`-git-staging-` alias re-pointed to pick up the new value — Deployment
Protection was confirmed still active (SSO redirect) both before and
after, and no Protection Bypass secret was created at any point.

Test data cleanup: the temporary contribution plan and the two
notifications it generated were deleted directly by id after the proof
completed; verified zero leftover rows on `Susu` afterward, and that
both real memberships (owner, member — both `active`) were untouched
throughout.

| Step | Result |
|---|---|
| Security headers present on a public page (`curl -I` against the live staging URL) | ✅ Confirmed — full header set present (CSP, HSTS, X-Frame-Options, etc.) |
| Security headers present on an authenticated dashboard page | ✅ Confirmed by direct manual inspection (Safari DevTools, Network tab, the dashboard document request) — not `curl`, since the staging deployment is intentionally gated by Vercel's own SSO/deployment-protection layer (a 302 to `vercel.com/sso-api` before the request ever reaches the app), and no bypass secret was configured for it, by explicit choice, to keep the Preview deployment genuinely private. Response was `200`; headers observed present by name: `Content-Security-Policy`, `Permissions-Policy`, `Referrer-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`. The CSP value itself still contains `'unsafe-inline'` in `script-src`/`style-src`, as documented in `next.config.ts` — a known, accepted tradeoff (required for Next's own inline hydration scripts), not a regression |
| No CSP console violations across a full click-through | ✅ Confirmed — see the bug account above for the sign-up page (verified via direct browser automation). The authenticated dashboard page was separately checked via direct Safari DevTools inspection and initially found **not** clean: `Refused to load https://vercel.live/_next-live/feedback/feedback.js because it does not appear in the script-src directive...` plus three related resource failures. Diagnosed (confirmed via `grep` across `src/`, `next.config.ts`, and Next.js's own `node_modules` — zero matches for `vercel.live`/`feedback.js` anywhere) as **not** an app or CSP-config bug at all: Vercel's own **Toolbar / Live Feedback** feature injects that script at the edge layer, after our app's response, independent of anything in this codebase. Fixed by disabling the Vercel Toolbar at the project level (both Production and Preview) in the Vercel Dashboard — no CSP change, no `vercel.live` allowance added, no Protection Bypass secret created, consistent with keeping the production CSP strict and Deployment Protection on throughout. Required a fresh deployment plus manually re-pointing the `-git-staging-` alias to it (the existing broken-git-integration issue extends to CLI `--prod` deploys too — see "Before Phase 10" below) before the setting change took visible effect. Re-verified clean via a cache-cleared reload in Safari DevTools after that |
| Officer exports another member's statement; confirm the `report_export_generated` audit row now carries `metadata.subject_member_id` matching the selected member, not the officer (item 1 fix) | ✅ Confirmed — officer (`wc-staging-test-1`) generated a statement for the other member (`wc-staging-member`) via the Reports page dropdown; downloaded CSV's `Member:` header and every line matched the selected member, not the officer. Independently cross-checked directly against the staging `audit_logs` table: the resulting `report_export_generated` row has `actor_id` set to the officer's id, and `metadata: { report_type: "member_statement", subject_member_id: "<member's id>", subject_member_name: "Staging Test Member" }` — the subject is correctly distinct from the actor |
| Invitation creation blocked after the configured rate-limit threshold, with a clear error message, not a silent failure | ✅ Confirmed via direct RPC test rather than 20 real invitations (product-owner choice) — `check_rate_limit()` correctly allows calls 1–3 and blocks call 4 with a `max=3` test window on the live staging project; the same function backs both the invitation and CSV-export limiters, just with different keys/thresholds |
| CSV export blocked after the configured rate-limit threshold (`429`) | ✅ Confirmed by the same underlying mechanism test above — the route handler's `429` response is a thin wrapper around this already-proven function |
| Invitation-preview page still works normally under normal use (rate limiting fails closed there — confirm it isn't over-triggering on legitimate traffic) | ✅ Confirmed — genuinely exercised via real use, not a synthetic call: setting up a real owner+member test group required clicking through several real `/invitations/[token]` links (including one stale/revoked one and the working one, plus a sign-in-then-redirect-back round trip), all handled correctly by the preview page without any rate-limit error shown. Independently cross-checked directly against the staging `rate_limit_buckets` table: the `preview:<ip>` key's current window shows `count: 1` against the route's `max=20` per-300s threshold — legitimate use came nowhere near triggering the fail-closed limit |
| Sign-up → Mailtrap confirmation email → `/auth/confirm` round trip works end-to-end on the staging deployment | ✅ Confirmed — full round trip (sign-up, click-to-confirm, sign-in) verified working, and independently checked against the staging project's `auth.users` table (`email_confirmed_at` correctly set) rather than relying on UI observation alone. See the SMTP note below for what it took to get here |
| Email still sends correctly after the `MAILTRAP_*` → `EMAIL_SMTP_*` rename (regression check) | ✅ Confirmed — this app's own notification emails (`EMAIL_SMTP_*`) were never the issue; see below for the separate, real gap this surfaced |
| `/api/scheduler/run` rejects a request with a missing/wrong bearer token (`401`) | ✅ Confirmed — `curl` with no `Authorization` header returns `401 {"error":"Unauthorized"}` |
| `/api/scheduler/run` succeeds with the correct token once a scheduler Supabase Auth account exists, and calling it twice in a row shows the second call reporting zero *new* notifications for identical input (dedupe proof) | ✅ Confirmed with a genuine overdue scenario, not a trivial zero-data call — see the full account below, including a real functional gap this surfaced (the scheduler currently can never flush group-scoped notification emails) and a mid-test credential-exposure incident that was safely remediated |
| `.github/workflows/ci.yml`'s `build-and-test` job passes on a real push/PR | ✅ Confirmed — both `main` and `staging` push-triggered runs show green in the Actions tab |
| `npm run check:production-env` fails clearly when a required Phase 9 var is missing, and passes once all are set | ✅ Confirmed — tested all three cases (nothing set, `SUPABASE_SECRET_KEY` set as a leak check, everything correctly set) with a clean environment via `env -i` |
| Migrations `0001`–`0017` apply cleanly in order to a brand-new Supabase project, and RLS behaves identically to the existing project | ✅ Confirmed — see `docs/phase-9-vercel-staging-checklist.md`; 128/128 live security tests pass against the new staging project |

## Cleanup

Setting up a real owner+member group on staging (`wc-staging-test-1`
owning "Susu", `wc-staging-member` joining it) produced one stray
artifact: the member account initially created its own separate group
("WEALTH MASTERS") instead of accepting an invitation, along with a
self-directed pending invitation on it. Verified before deletion that
the group had exactly one membership (the test member itself, as
owner), zero contributions/loans/withdrawals/governance/document rows,
and only test-generated audit-log entries — then deleted the `groups`
row directly against the staging project only (confirmed by project
ref prefix, distinct from the main project's), which cascaded the
membership, invitation, and audit rows automatically per their `on
delete cascade` foreign keys; the one non-cascading `rate_limit_buckets`
row keyed to that group was deleted separately. Verified zero rows
remained afterward across all four tables. "Susu" and both accounts'
legitimate memberships were untouched throughout.

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

## Scheduler email capability fix (migration 0018)

Closes the gap found during the earlier dedupe proof: the scheduler
could create reminder notifications but never flush their emails,
because `claim_pending_notification_emails()` only claimed a
notification if its recipient shared a group with the caller — a rule
that can never be true for the deliberately memberless scheduler
account.

**Design decision**: a private `scheduler_capabilities` table keyed by
`auth.uid()`, checked via a new `is_active_scheduler()` `security
definer` function — the same "narrowly-scoped function over a
dedicated table" pattern as every other privilege check in this schema
(`is_group_member()`, `is_group_manager()`, etc.), chosen over a
JWT/`app_metadata`-based capability specifically because revocation is
immediate (a live table read on every call) rather than lagging until
a session's token next refreshes. RLS on the new table has zero
policies — not even the scheduler account itself can read or write it;
the only way in is the out-of-band grant below. Full threat model and
approach comparison were presented and reviewed before implementation.

**What changed**: `claim_pending_notification_emails()` and
`mark_notification_email_result()` — same signatures, `create or
replace`, additive `OR is_active_scheduler()` alongside the unchanged
group-sharing condition. `claim_pending_notification_emails()` also
gained a 15-minute retry cooldown for rows stuck in `sending` (crashed
flush) or `failed` (real send error), closing the "abandoned claim"
gap. A genuinely separate, adjacent bug was found and closed in the
same migration: `mark_notification_email_result()` previously had *no*
ownership check at all — any authenticated user could resolve any
in-flight notification by id. Zero application code changes were
needed — `route.ts`/`flush.ts` already called these functions with the
same signatures.

**Applying it required two retries**: the first SQL Editor run reported
"Success" but independent verification (querying the table/function
directly) showed neither existed — most likely a partial paste.
Re-pasting the entire file (idempotent — `create table if not exists`,
`create or replace function`) resolved it cleanly, confirmed
independently both times rather than trusting the reported "Success."

**Granting the capability**: done via a plain `insert` into
`scheduler_capabilities` for the existing `wc-scheduler-staging`
account's id, run directly in the Supabase SQL Editor by the project
owner — deliberately not via any script on this side, so the
service-role key was never touched for this step at all, not just kept
unprinted.

**Test suite**: 5 pure unit tests (`src/app/api/scheduler/run/route.test.ts`
— bearer-token gate, no live DB) plus 8 live tests appended to
`tests/security/notifications.test.ts` covering capability isolation,
outsider/role-based denial, bounded batch claiming, no direct
table access to financial/group data, no immediate double-claim,
cooldown-gated retry, and instant disable/re-enable. One live-suite
iteration surfaced a real test-isolation bug (not a security bug): two
denial tests deliberately leave a notification `pending` (nobody was
entitled to claim it), and since the scheduler's reach isn't scoped to
one group, a later test's claim swept those up too — fixed by having
each denial test clean up its own leftover row. A second, minor issue
(asserting strict FIFO claim order, which `claim_pending_notification_emails()`
has never actually guaranteed — no tiebreaker on `created_at`, unchanged
by this fix) was corrected to assert bounding + eventual full coverage
instead. Final state: **136/136 live security tests pass**, **157/157
unit tests pass**, typecheck/lint/build all green.

**Mailtrap walkthrough**, run against a fresh, temporary, clearly-labelled
overdue-contribution plan on the real "Susu" staging group (same
construction as the earlier dedupe proof), via the local-dev-against-staging
method (Deployment Protection kept fully on throughout, no bypass
secret):
- **Run 1**: `emailsSent: 1, emailsFailed: 1` — one notification
  genuinely delivered through Mailtrap (`email_status: "sent"`,
  `email_error: null`); the other hit Mailtrap's own external per-second
  rate limit (`550 5.7.0 Too many emails per second`), a real,
  independent constraint already known from earlier in this project, not
  a bug in the fix.
- **Run 2**, immediate: `emailsSent: 0, emailsFailed: 0`, zero new
  notifications, both rows' `email_attempted_at` unchanged — confirms no
  duplicate claim and no duplicate send.
- **Retry proof**: the failed row's `email_attempted_at` was backdated
  20 minutes (service-role only, simulating the cooldown), then a third
  call correctly reclaimed and successfully sent it
  (`email_status: "sent"`, error cleared) — the full failed→cooldown→retry→sent
  path proven through the real HTTP endpoint, not just the RPC layer.

**Credential handling during this work**: the scheduler test account's
password and `SCHEDULER_SECRET` needed re-rotating mid-walkthrough after
`.env.staging.local` was found to have silently lost both values (empty
after an earlier edit) — same secure procedure as established
previously (generated in a script that never logs the value, written
directly to `.env.staging.local` and a scratchpad file outside the
repo, piped into `vercel env update` via stdin redirection, files
deleted immediately after). Neither value was ever printed, echoed, or
exposed in chat, a command, or a log.

**Cleanup**: the temporary contribution plan and its two notifications
were deleted by id and verified gone; "Susu"'s real memberships
(owner + member, both `active`) and the scheduler's capability grant
(exactly one row, `is_active: true`) were confirmed unchanged
throughout.

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
   push-to-deploy for real work. This extends further than previously
   known: a `vercel --prod` CLI deploy creates a new deployment fine,
   but does **not** automatically re-point the existing
   `wealth-circle-app-git-staging-...vercel.app` alias to it (confirmed
   twice during the Vercel-Toolbar CSP fix above) — `vercel alias set
   <new-deployment-url> <git-staging-alias>` must be run manually after
   every CLI deploy until the underlying Git integration is fixed.
4. The five scheduled-job RPCs don't yet check caller identity
   internally — a known, accepted, low-severity gap (each is
   idempotent and exposes only a count) documented in
   `docs/security-boundaries.md`'s Phase 9 section. Worth closing once
   the scheduler account exists to check against.
5. ~~The scheduler can create notifications but can never flush their
   emails~~ — **Fixed** in `supabase/migrations/0018_phase9_scheduler_email_capability.sql`,
   verified end-to-end against staging including a real Mailtrap
   delivery. See "Scheduler email capability fix" below.
6. Edge/CDN-level rate limiting is not implemented — the current
   Postgres-backed limiter is right-sized for MVP traffic, not
   abuse-at-scale.
7. `npm audit` is wired into CI as warn-only, not build-failing — a
   deliberate starting point, worth tightening once there's a process
   for triaging findings.
