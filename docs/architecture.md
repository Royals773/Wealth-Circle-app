# Architecture

## Stack

- **Next.js 16** (App Router, Turbopack build), TypeScript in `strict` mode
- **Tailwind CSS v4**
- **shadcn/ui** (Radix UI primitives + `class-variance-authority`)
- **Supabase** — Postgres, Auth, Row Level Security. As of Phase 2, a
  dedicated Supabase project is connected for real authentication,
  onboarding and invitations — see "Supabase-ready architecture" below
  for how the app still degrades gracefully without one.
- **Zod** for validation
- **React 19** Server Actions + `useActionState` for form handling

## Why these choices

- **App Router + Server Components by default.** Data-bearing pages (e.g.
  the members list, overview counts) are `async` Server Components that
  query Supabase directly with the signed-in user's session — there is no
  separate client-fetched API layer to keep in sync with RLS.
- **Server Actions instead of API routes** for mutations (sign-up, sign-in,
  group creation, invitations). Each action validates input with Zod on the
  server before touching Supabase, so validation cannot be bypassed by
  calling an endpoint directly.
- **Radix-based shadcn/ui** (as opposed to the newer Base UI preset) was
  chosen specifically so `Button`/`Link` composition via `asChild` works
  throughout the app — this is used extensively across the marketing site,
  auth screens and dashboard.

## Route structure

```
src/app/
  (marketing)/            Public site — header, footer, "/" homepage
  (auth)/                 Sign up, sign in, forgot/reset password,
                           verify email, accept invitation — no header/footer
  auth/
    confirm/route.ts       token_hash-based email verification (OTP)
    callback/route.ts      PKCE `code` exchange
  onboarding/              Guided group creation / join flow
  (dashboard)/dashboard/
    page.tsx               Redirects to the user's first group, or
                            onboarding if they have none
    [groupId]/             Group-scoped dashboard shell (sidebar + topbar)
      page.tsx              Overview
      contributions/ loans/ repayments/ members/ withdrawals/
      approvals/ governance/ reports/ notifications/ settings/
```

Route groups `(marketing)`, `(auth)`, `(dashboard)` each get their own
`layout.tsx` without affecting the URL path. `/dashboard/*` and
`/onboarding/*` are protected by `src/proxy.ts` — signed-out visitors are
redirected to `/sign-in?next=<original path>`.

## Authentication flow

- **Sign-up**: `signUpAction` (`src/lib/actions/auth.ts`) calls
  `supabase.auth.signUp()` with `emailRedirectTo` pointing at the final
  destination (e.g. `/onboarding`) — this becomes `{{ .RedirectTo }}` in
  the email template. The error message is deliberately identical
  whether the email is new or already registered (Supabase's
  `user_already_exists`/`email_exists` error codes are treated the same
  as success), so the form can't be used to enumerate accounts.
- **Email verification**: `src/app/auth/confirm/page.tsx` is a **two-step**
  confirmation page, not an auto-verifying route — this is a deliberate
  fix for a real bug found during manual testing (see
  [security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing)):
  a `GET` that verifies immediately is indistinguishable, from the
  server's perspective, from an email provider's automatic link-safety
  prefetch, which silently burns the single-use token before the
  recipient ever clicks. The page renders an explicit "Confirm" button;
  only submitting it (`confirmEmailAction`) calls `verifyOtp()`. Supabase's
  "Confirm signup" and "Reset Password" email templates must link here
  directly with `token_hash`/`type` — see security-boundaries.md for the
  exact template snippet. `src/app/auth/callback/route.ts` (PKCE `?code=`
  exchange) still exists for any future OAuth-provider redirect but is no
  longer used by the email flows. Both validate any `next` redirect
  target with `src/lib/safe-redirect.ts` before using it.
- **Sign-in**: `signInAction` validates and calls
  `supabase.auth.signInWithPassword()`, then redirects to a validated
  `next` if one was supplied (e.g. by the proxy bouncing a signed-out
  visitor), otherwise to `/dashboard` — which itself resolves to the
  user's first group or to `/onboarding` if they don't have one yet.
- **Sign-out**: `signOutAction` calls `supabase.auth.signOut()` (which
  clears the session cookies via the server client's cookie adapter) and
  returns to `/`.
- **Password reset**: `forgotPasswordAction` always reports success
  regardless of whether the address is registered. The reset link goes
  through the same two-step `/auth/confirm` page as email verification
  (with `type=recovery` and `next=/reset-password`), landing on
  `/reset-password` only after the explicit confirm step;
  `resetPasswordAction` checks a session actually exists before calling
  `updateUser()`, and maps an expired/invalid link to a plain-language
  message rather than a raw Supabase error.
- Every server-side "is this user authenticated" check uses
  `supabase.auth.getUser()`, never `getSession()` — `getUser()`
  revalidates the JWT against Supabase's auth server rather than trusting
  the cookie payload alone.

## Group creation and invitations

Both are implemented as Postgres functions in
`supabase/migrations/0002_phase2_auth_functions.sql`, called via
`supabase.rpc(...)`, rather than as sequential client-side `.insert()`
calls — see [security-boundaries.md](./security-boundaries.md) for the
full reasoning (atomicity, and why direct self-service `INSERT`s into
`group_memberships` are no longer allowed at all).

- `create_group_with_setup` — group + owner membership (via the existing
  trigger) + optional initial contribution plan + optional initial
  invitations + an audit log entry, in one transaction.
- `create_invitation` / `revoke_invitation` — manager-only (checked via
  `is_group_manager`), used by the Invite dialog and pending-invitations
  list on the Members page.
- `get_invitation_preview` — public, token-gated read used by the
  `/invitations/[token]` landing page before the visitor has an account.
- `accept_invitation` — the only way a user can add themselves to a
  group; validates the invitation and that the caller's verified email
  matches it before inserting the membership.

## Contributions and reconciliation (Phase 3)

The contribution ledger is `contribution_plans` (one active row per
group, describing fixed/flexible, amount, optional minimum, frequency)
and `contribution_records` (one row per recorded payment). The write path
is six Postgres RPCs in
`supabase/migrations/0006_phase3_contributions.sql` —
`upsert_contribution_plan`, `record_contribution`, `verify_contribution`,
`reconcile_contribution`, `reject_contribution`, `reverse_contribution` —
called from `src/lib/actions/contributions.ts`, following the exact
Server Action shape already used for invitations (Zod validate →
`isSupabaseConfigured` guard → `supabase.rpc(...)` → `revalidatePath`).
See [security-boundaries.md](./security-boundaries.md#contribution-ledger-integrity-phase-3)
for the RLS/trigger enforcement behind each of these.

A single ledger entry moves through
`pending_verification → verified → reconciled`, or
`pending_verification → rejected`, or, for a record already verified or
reconciled, `→ reversed` (optionally producing a new linked replacement
row via `reverse_contribution`'s `p_replacement`). Once a record is
verified or reconciled, its financial fields are locked — a database
trigger, not just RLS, refuses direct edits (see security-boundaries.md);
the only way to correct it is that reversal workflow.

**Period and overdue math is pure TypeScript, not SQL.**
`src/lib/contribution-periods.ts` computes which period (start/end date)
a given date falls into for a plan's frequency, using plain
year/month/day integer arithmetic rather than `Date` objects, so there's
no timezone ambiguity — every date in and out is a plain `YYYY-MM-DD`
string, matching Postgres `date` columns exactly. `src/lib/contributions.ts`
computes a member's status for a period (`paid`/`partial`/`unpaid`/
`overdue`/`not_applicable`) from their verified total against the plan's
required amount — a flexible plan with no minimum is never `overdue`,
and a period that ended before a member joined is `not_applicable`. Both
files are pure and unit-tested (`src/lib/contribution-periods.test.ts`,
`src/lib/contributions.test.ts`); the Contributions dashboard and
"My contributions" view are Server Components that fetch RLS-scoped rows
and call these functions — a balance is always recomputed server-side,
never trusted from a value the browser sent.

The Contributions page (`.../contributions/page.tsx`) is one route,
role-gated: officers with `record_contributions` capability (owner/
administrator/treasurer) see an "Overview" tab (stat cards, filters, the
full ledger table with Verify/Reconcile/Reject/Reverse actions, and
"Record contribution") plus a "My contributions" tab for their own
records; everyone else sees only "My contributions" — there's no
separate route or nav item, since a plain member has nothing else to see
there anyway.

## Loans and repayments (Phase 4)

Extends the Phase 1 `loan_products`/`loan_applications`/`loans`/
`repayments` tables rather than adding new ones —
`supabase/migrations/0007_phase4_loans.sql` follows the same
`SECURITY INVOKER` + explicit role check + audit log pattern as
0002/0006, with twelve new RPCs covering the full lifecycle:
`upsert_loan_product`, `apply_for_loan`, `mark_loan_under_review`,
`decide_loan_application`, `cancel_loan_application`,
`record_disbursement`, `mark_loan_defaulted`, `record_repayment`,
`verify_repayment`, `reconcile_repayment`, `reject_repayment`,
`reverse_repayment`. See
[security-boundaries.md](./security-boundaries.md#loan-ledger-integrity-phase-4)
for the RLS/trigger enforcement, including a real Phase 1 self-approval
bug this migration fixed.

**Lifecycle**: `apply_for_loan` recomputes eligibility (borrowing limit
as a percentage of verified contributions, minus existing outstanding
principal) entirely server-side and rejects anything over the limit,
regardless of what the client sends. An application moves
`submitted → under_review → approved` or `rejected`; approval snapshots
the agreed terms (which may differ from what was requested) and creates
a `loans` row with status `awaiting_disbursement` in the same
transaction — never `active` yet. Only `record_disbursement`, called
after an officer confirms the money actually left the group's bank
account, moves it to `active`. From there, `record_repayment` /
`verify_repayment` / `reconcile_repayment` / `reject_repayment` /
`reverse_repayment` mirror the Phase 3 contribution ledger's workflow
and immutability guarantees exactly.

**Overdue-contribution eligibility is exact, not approximated.**
`apply_for_loan`'s "does this member have overdue contributions"
check — which gates eligibility unless a group's policy explicitly
allows overdue members — is computed by
`member_has_overdue_contributions()`
(`supabase/migrations/0009_exact_overdue_contribution_eligibility.sql`),
a faithful PL/pgSQL port of `contribution-periods.ts`'s period math
(`add_months_clamped`/`contribution_period_start`/
`contribution_period_index`/`contribution_period_end`) and
`contributions.ts`'s `computeMemberPeriodStatus` overdue rule. SQL can't
call TypeScript, so the algorithm is necessarily expressed twice, but
`tests/security/loan-eligibility-calendar.test.ts` proves the two stay
in agreement — calling the SQL period functions directly against the
same boundary cases already proven correct for the TypeScript version
(month-end clamping, leap years, 28th–31st due dates), plus end-to-end
`apply_for_loan()` scenarios for join date, partial contributions,
contribution-status filtering, and flexible plans with/without a
minimum. See
[security-boundaries.md](./security-boundaries.md#loan-ledger-integrity-phase-4)
for the two earlier, less-exact iterations this replaced. The
overdue-**repayments** check (separate from overdue-contributions) still
uses a day-count approximation.

**No stored overdue/fully-repaid/partly-paid status.** `loans.status`
only ever holds `awaiting_disbursement`/`active`/`defaulted`/`cancelled`
— everything past that is computed by `src/lib/loans.ts`
(`computeLoanStatus`, `computeLoanRepaymentSchedule`,
`outstandingPrincipal`) from the schedule and verified repayments,
called only from Server Components against RLS-scoped rows. This is the
same reasoning Phase 3 already established for contributions: a stored
flag can go stale without a background job this project doesn't run;
a computed one can't. `computeLoanRepaymentSchedule` reuses
`getPeriodContaining`/`listPeriodsBetween`/`addMonths` from
`src/lib/contribution-periods.ts` directly for instalment due dates —
the same period-generation primitive, not a re-implementation.

**One-time flat interest and allocation.** `computeOneTimeFlatInterest`
computes the interest once at approval time (stored on the `loans` row,
never recomputed against a policy that might later change).
`computeProportionalAllocation` splits every repayment between principal
and interest in the loan's overall principal:total-repayable ratio —
the one policy this phase implements, since one-time flat is the only
supported interest type. All of `src/lib/loans.ts` and
`src/lib/loan-eligibility.ts` are pure, integer-minor-units-only, and
unit-tested (`src/lib/loans.test.ts`, `src/lib/loan-eligibility.test.ts`).

**UI** mirrors the Contributions page's shape: `.../loans/page.tsx` is
role-gated tabs (an officer "Overview" — review queue, disbursement
recording, principal/interest stats — plus "My loans" for everyone,
including the eligibility preview and apply flow), and
`.../repayments/page.tsx` is an officer-only ledger (members see their
own repayment history via the Loans page instead, since RLS already
limits what they could see there anyway).

## End-to-end dashboards (Phase 5)

Phase 5 didn't add new backend capability beyond one small RPC — it
consolidated what Phases 3-4 already compute into three real,
role-appropriate dashboards, and refactored the Contributions/Loans
pages to source their numbers from the same place the new Overview
dashboard does.

**Shared server-only loaders** — `src/lib/data/contribution-summary.ts`
and `src/lib/data/loan-summary.ts` — hold every group-wide and
per-member aggregate calculation (expected/received/outstanding
contributions, overdue member detection, monthly per-member status,
missed-contribution periods, loan summary stats, member loan
eligibility). `.../contributions/page.tsx` and `.../loans/page.tsx`
call these instead of keeping local copies, and so does the group
Overview page — a number like "expected this period" or "eligible to
borrow up to" is computed exactly once per request, not re-derived in
two places that could quietly drift apart.

**`.../dashboard/[groupId]/page.tsx`** (the group Overview page) is now
role-aware, split on the same `roleHasCapability(role, "view_reports")`
check already used elsewhere: officer roles (owner/administrator/
treasurer/loan_officer/auditor) see an **admin dashboard** (active/
overdue member counts, expected/received/outstanding contributions,
loan summary); a plain `member` sees a **member dashboard** (current
balance, total contributions, recent history, a missed-contributions
table, and a loan eligibility card using the exact `computeEligibility()`
result the apply-for-loan flow itself uses — the two can never
disagree).

**Editing a still-pending contribution** — the one real gap Phase 3
left: a treasurer could previously only reject-and-re-record or (after
verification) reverse a mistaken entry, with nothing in between for a
plain typo caught before verification. `edit_contribution()`
(`supabase/migrations/0010_edit_pending_contribution.sql`) fills it,
allowed only while a record is `pending_verification`; see
[security-boundaries.md](./security-boundaries.md#editing-a-still-pending-contribution-phase-5).

## Withdrawals and governance (Phase 6)

Builds the write path on `withdrawal_requests`/`withdrawal_policies`
and `governance_proposals`/`votes` — all present since the Phase 1
schema but unused until now — via
`supabase/migrations/0011_phase6_withdrawals_governance.sql` and a
follow-up correction, `0012_fix_withdrawal_reserved_balance.sql`.

**Withdrawals** route every approval through the generic
`approval_requests`/`approval_decisions` pair rather than a hardcoded
two-person check, so the number of required approvals is a per-group
`withdrawal_policies.required_approvals` setting. The lifecycle is
`submitted → under_review → awaiting_payment → paid_externally`, or
`→ rejected`/`→ cancelled` along the way, or `→ reversed` from
`paid_externally`. Approval and payment are deliberately two separate
RPCs (`decide_withdrawal_request()` vs. `confirm_withdrawal_payment()`)
— reaching the required approval count never itself marks a withdrawal
paid. The available-balance calculation
(`computeAvailableWithdrawalAmount`/`computeWithdrawalEligibility` in
`src/lib/withdrawals.ts`, mirrored server-side in both `request_withdrawal()`
and `decide_withdrawal_request()`) is `verified contributions −
outstanding loan principal − amounts reserved by open requests or
already paid out`, floored at zero — see
[security-boundaries.md](./security-boundaries.md#withdrawal-ledger-integrity-phase-6)
for the real bug this had at first (paid withdrawals didn't reduce the
balance) and how it was found and fixed.

**Governance** proposals lock their material terms once voting opens —
there's no update RPC for title/dates/thresholds, only
`cancel_governance_proposal()`, itself restricted once voting has
started. Voter eligibility (`src/lib/governance.ts`'s
`isEligibleVoter`, mirrored in `cast_vote()`) is a join-date-before-
voting-opened comparison, the same point-in-time approach Phase 3/4
already established for contribution/loan eligibility, rather than a
physical snapshot table. A proposal's result (`computeProposalResult`)
is never stored — always derived live from vote counts, quorum and
threshold, the same "don't persist a status that could go stale"
approach as `computeLoanStatus`. Live vote visibility is restricted
while voting is open (own vote only, unless owner/administrator/
auditor) and opens to everyone once voting closes — see
security-boundaries.md for the real UI bug this surfaced (a plain
member's "current tally" view was actually just their own vote,
presented as if complete) and its fix.

A group's withdrawal policy can set a `large_withdrawal_threshold_minor_units`
above which a request must link to a governance proposal that has
actually passed before an officer can approve it — enforced inside
`decide_withdrawal_request()` via `compute_proposal_passed()`, a
`SECURITY DEFINER` SQL mirror of `computeProposalResult` (SQL can't
call TypeScript), narrowly scoped so this one server-side check isn't
itself blocked by the votes-visibility restriction.

**UI**: a Withdrawals page (officer queue + member request/lifecycle,
mirroring the Loans page's tab shape), an Approvals page (cross-cutting
queue of requests awaiting the signed-in officer's decision — for now
populated only by `subject_type = 'withdrawal_request'`), a Governance
page (proposal creation, voting, results), and the group Overview page
extended with Withdrawals/Governance stat groups for both the officer
and member dashboards — all sourced from `src/lib/data/withdrawal-summary.ts`
and `src/lib/data/governance-summary.ts`, following Phase 5's
shared-loader principle so a number can never disagree between where
it's shown twice.

## Member and role management (Phase 7)

Adds `supabase/migrations/0013_phase7_member_management.sql` (a new
`ownership_transfers` table, `active_owner_count()`/
`member_removal_blockers()` SQL helpers, a replaced pair of
`group_memberships` RLS policies, and nine new RPCs) plus a follow-up
error-message fix, `0014_fix_member_management_owner_lock_visibility.sql`
— see
[security-boundaries.md](./security-boundaries.md#member-and-role-management-integrity-phase-7)
for the RLS gap this phase closes and the bug the fix corrects.

Every membership state change (`change_member_role`, `suspend_member`,
`reactivate_member`, `remove_member`, `leave_group`, and the four
`*_ownership_transfer` RPCs) is `SECURITY INVOKER` and re-checks role,
target status, and self-targeting from scratch server-side, except
`accept_ownership_transfer()` — `SECURITY DEFINER`, following the same
shape as `accept_invitation()`, since it's the one operation that
structurally requires promoting the caller and demoting someone else in
a single transaction. Ownership transfer is deliberately two-step
(`initiate_ownership_transfer()` by the current owner, then
`accept_ownership_transfer()`/`decline_ownership_transfer()` by the
named recipient, or `cancel_ownership_transfer()` by any current owner)
rather than an instant handoff, with no email notification (in-app UI
only, per the phase boundary) and a 7-day expiry matching invitations.

`src/lib/data/member-directory.ts` provides two loaders: `loadMemberDirectory()`
(officer-only — the full roster plus financial-obligation indicators
computed via six parallel queries, and the most recent role/status
change per member from `audit_logs`) and `loadBasicRoster()` (what every
member has always seen since Phase 1/2 — name, role, status, joined
date, unchanged). The Members page renders one or the other based on
`roleHasCapability(currentRole, "manage_members")`; no new
`permissions.ts` capability was needed since this maps directly onto
the existing `manage_members` capability. Row actions (change role,
suspend, remove) are bundled into one `DropdownMenu` per row — important
on the mobile card layout, where there's no room for four separate
buttons — and gated client-side by the same capability check, with
every actual mutation re-verified server-side by RLS and the RPC's own
checks regardless of what the UI shows.

**A significant scope reducer, not implemented as new code**: suspension
already revokes both read and write access everywhere in the app the
moment `group_memberships.status` changes, because every RLS-gated
table's policies ultimately call `is_group_member()`/`has_group_role()`/
`is_group_manager()`, and all three have filtered on `status = 'active'`
since Phase 1. This satisfied the spec's "block prohibited actions
immediately" and "a stale session can't retain permissions" requirements
with zero additional RLS changes anywhere outside `group_memberships`
itself.

## Reports, notifications and audit (Phase 8)

Adds `supabase/migrations/0015_phase8_reports_notifications_audit.sql`
(new `notifications` columns, new `notification_preferences` table,
8 new functions, and an additive `perform create_notification(...)`
call in 26 existing lifecycle RPCs) plus a follow-up correction,
`0016_fix_accept_invitation_ambiguous_column_regression.sql` — see
[security-boundaries.md](./security-boundaries.md#notification-and-reporting-integrity-phase-8)
for both the notification-delivery architecture and the two bugs the
follow-up fixes.

**Reports need no new schema at all.** `src/lib/data/reports-summary.ts`
composes `loadGroupContributionSummary`/`loadGroupLoanSummary`/
`loadGroupWithdrawalSummary` (all reused from Phase 5, not
reimplemented) into a group financial overview, plus a small set of
direct queries for the filterable transaction detail list, arrears, and
reconciliation-exceptions reports. `src/lib/data/member-statement.ts`
computes opening/closing ledger balance (verified contributions minus
paid withdrawals, as of a date) live, never a stored snapshot — the
same "don't persist what can be recomputed" rule as `computeLoanStatus`/
`computeProposalResult`. CSV export is a Route Handler
(`.../reports/export/route.ts`), not a Server Action, since a real file
download needs genuine `Content-Disposition` response headers;
`src/lib/csv.ts` provides the formula-injection-safe serializer, unit
tested directly.

**Notifications are created inside the same transaction as the
triggering mutation, via `create_notification()`** — a `SECURITY
DEFINER` helper following the same pattern as Phase 7's
`member_removal_blockers()`. Every existing lifecycle RPC across
`0002`/`0006`/`0007`/`0011`/`0013` gained one additive call next to its
existing `audit_logs` insert; nothing about any RPC's existing checks
or error messages changed. Idempotency is a `dedupe_key` column with a
partial unique index, not application-level deduplication.

**Email is a Next.js-layer side effect, since Postgres can't send
SMTP.** `src/lib/email/mailer.ts` (nodemailer + Mailtrap SMTP, safe
no-op when unconfigured, mirroring `isSupabaseConfigured`) and
`src/lib/email/templates.ts` (one shared, generic, accessible template)
are used by `flushPendingNotificationEmails()` in
`src/lib/actions/notifications.ts`, called after every
notification-emitting Server Action's `revalidatePath` and once more
from the Notifications page on load — best-effort and synchronous, no
queue/worker. `claim_pending_notification_emails()` and
`mark_notification_email_result()` are the two narrow `SECURITY
DEFINER` seams this needs; `SUPABASE_SECRET_KEY` is still never
referenced anywhere under `src/` — the scheduled reminder functions are
tested by calling them directly with the same admin client
`tests/security/*.test.ts` already uses for setup/teardown, never from
application code.

**UI**: a rewritten Reports page (financial overview with filters and
CSV export, arrears and reconciliation-exceptions cards, membership/
governance/audit CSV export buttons, and a member-statement generator
usable by every member for themselves and by officers for anyone), a
rewritten Notifications page (unread count, mark one/all read,
pagination, group/category filters — `src/lib/data/notification-summary.ts`),
a notification-preferences card on Settings
(`src/components/dashboard/notification-preferences-form.tsx`), and a
new Audit log page (`.../audit/page.tsx`, filterable by date/actor/
target type/domain, gated identically to the existing `audit_logs` RLS
policy — `categorizeAuditAction()` in `src/lib/data/audit-summary.ts`
derives the "domain" filter from the existing `action` string, no new
column).

## Supabase-ready architecture (still works with zero credentials)

Even though a real Supabase project is now connected for Phase 2, every
piece of the integration is still written so the app **builds and the
public site renders with zero environment variables set** — useful for
CI, forks, and reviewing the UI structure without provisioning a backend:

- `src/lib/env.ts` — Zod-validated environment access
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_APP_URL`, `SUPABASE_SECRET_KEY`). Supabase variables are
  typed as optional; nothing throws at import time when they're absent.
- `isSupabaseConfigured` (exported from `env.ts`) gates every place the app
  talks to Supabase. Server Actions and data loaders check it first and
  return a clear, honest message ("Supabase isn't configured yet…") instead
  of crashing or fabricating data.
- `src/lib/supabase/client.ts` — browser client (publishable key only,
  PKCE flow).
- `src/lib/supabase/server.ts` — server client for Server Components/Actions,
  backed by the request's cookies so RLS applies as the signed-in user.
- `src/lib/supabase/middleware.ts` + `src/proxy.ts` — refreshes the auth
  session on every request and redirects signed-out users away from
  `/dashboard` and `/onboarding`. No-ops entirely when Supabase isn't
  configured, so those routes remain browsable as a structural preview
  (clearly labelled as such in the UI) without a backend. Once Supabase
  *is* configured (as it now is), this preview branch is simply dead code
  for that environment — every dashboard route goes through the same
  real auth + membership check as any other.
- `src/lib/types/database.ts` — hand-written types mirroring both
  migrations, including a typed `Functions` map for the Phase 2 RPCs.
  Regenerate with `supabase gen types typescript` once you want full
  fidelity with the live schema — see
  [data-model.md](./data-model.md#regenerating-typescript-types-from-a-live-project).

**No elevated key (`SUPABASE_SECRET_KEY`, formerly "service_role") is
referenced from any file under `src/`, in Phase 1 or Phase 2.** Every
Phase 2 feature that needs to act across the Row Level Security boundary
(previewing an invitation before signup, accepting one) does so through a
narrowly-scoped `SECURITY DEFINER` Postgres function instead — see
[security-boundaries.md](./security-boundaries.md).

### `next dev`/`next build` without credentials

The homepage and every marketing/auth page are plain Server Components with
no required data fetch, so they render immediately. Dashboard pages that do
fetch data (`overview`, `members`, `notifications`, `settings`) check
`isSupabaseConfigured` and return zeroed/empty results instead of querying,
so `next build` never attempts a network call during static analysis, and
visiting them without credentials shows the real empty-state UI rather than
an error.

## Money, currency and time

- Amounts are stored and passed around as **integer minor units** (e.g.
  pence, cents) — see `src/lib/money.ts`, which is the only place
  major/minor unit conversion happens (`majorToMinorUnits`,
  `minorToMajorUnits`, `formatMoney`).
- Every amount column has a paired ISO 4217 `currency_code`.
- All timestamps are `timestamptz`, stored in UTC.

## Permissions

`src/lib/permissions.ts` defines the six group roles and a capability map
used to drive **UI** decisions (what to show/hide, which actions to offer).
It intentionally mirrors, but is not a substitute for, the Postgres RLS
policies in the migration — see
[security-boundaries.md](./security-boundaries.md) for why RLS is the real
boundary and this module is not.

## Testing

Two layers:

- **Unit tests** (`npm run test`, Vitest): Zod validation schemas, the
  money conversion helpers, the permissions capability map, the
  open-redirect guard in `src/lib/safe-redirect.ts`, the Phase 3
  contribution period/overdue-status math (`contribution-periods.test.ts`,
  `contributions.test.ts`), the Phase 4 loan eligibility/schedule/
  interest/allocation math (`loan-eligibility.test.ts`, `loans.test.ts`),
  the Phase 6 governance result/eligibility math (`governance.test.ts`),
  and the Phase 8 CSV formula-injection escaping, ledger date-boundary
  arithmetic, and audit-action domain categorization (`csv.test.ts`,
  `member-statement.test.ts`, `audit-summary.test.ts`). These run with
  no Supabase project and are part of the standard build gate. 152
  currently pass.
- **Live security tests** (`npm run test:security`, gated behind real
  Supabase credentials — see `tests/security/README.md`): exercise Row
  Level Security and the invitation lifecycle
  (`tenant-isolation.test.ts`), the contribution ledger's RLS/RPCs/
  immutability trigger (`contributions.test.ts`), the loan ledger's
  eligibility enforcement, self-approval prevention, and disbursement/
  repayment workflow (`loans.test.ts`), exact calendar-period agreement
  between the SQL and TypeScript eligibility calculations
  (`loan-eligibility-calendar.test.ts`), the Phase 6 withdrawal and
  governance RLS/RPCs (`withdrawals.test.ts`, `governance.test.ts`), the
  Phase 7 member/role-management RLS/RPCs (`membership.test.ts`), and
  the Phase 8 notification pipeline — recipient selection, dedupe on
  retry, read/unread, cross-group isolation, preference enforcement
  (including the essential-category override), the
  same-group-bounded email claim, and the scheduled reminder/expiry
  functions called directly (`notifications.test.ts`); report
  visibility including the `loan_officer` gap (`reports.test.ts`); and
  audit log permission boundaries and append-only immutability
  (`audit.test.ts`) — against an actual project using real test users
  and groups. Skipped automatically (not failed) when Supabase env vars
  aren't present, so the standard build/test gate never depends on a
  live project. All 127 currently pass against a live project; running this
  suite is what caught the two bugs fixed in `0003`/`0004` (see
  [security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing)),
  the Phase 6 balance and tally-visibility bugs, the Phase 7 owner-lock
  error-message bug fixed in `0014`, and the two Phase 8 regressions
  fixed in `0016`.

UI composition is verified by building the app and visually checking key
pages rather than with brittle snapshot tests at this stage.
