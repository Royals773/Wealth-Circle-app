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
  `contributions.test.ts`), and the Phase 4 loan eligibility/schedule/
  interest/allocation math (`loan-eligibility.test.ts`, `loans.test.ts`).
  These run with no Supabase project and are part of the standard build
  gate.
- **Live security tests** (`npm run test:security`, gated behind real
  Supabase credentials — see `tests/security/README.md`): exercise Row
  Level Security and the invitation lifecycle
  (`tenant-isolation.test.ts`), the contribution ledger's RLS/RPCs/
  immutability trigger (`contributions.test.ts`), the loan ledger's
  eligibility enforcement, self-approval prevention, and disbursement/
  repayment workflow (`loans.test.ts`), and exact calendar-period
  agreement between the SQL and TypeScript eligibility calculations
  (`loan-eligibility-calendar.test.ts`) against an actual project using
  real test users and groups. Skipped automatically (not failed) when
  Supabase env vars aren't present, so the standard build/test gate never
  depends on a live project. All 56 currently pass against a live
  project; running this suite is what caught the two bugs fixed in
  `0003`/`0004` (see
  [security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing)).

UI composition is verified by building the app and visually checking key
pages rather than with brittle snapshot tests at this stage.
