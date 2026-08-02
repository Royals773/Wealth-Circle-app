# MVP Roadmap

## Phase 1 — Product and technical foundation *(complete)*

- Next.js + TypeScript strict + Tailwind + shadcn/ui project foundation
- Public marketing website (hero, product explanation, features, how it
  works, who it's for, security & transparency, pricing placeholder, FAQ,
  sign-in/create-account CTAs, footer with the "we don't hold your money"
  disclosure)
- Authentication screens (sign up, sign in, forgot/reset password, verify
  email, accept invitation) — UI and Server Action architecture wired for
  Supabase Auth, no live credentials or hard-coded users
- Guided group onboarding (create a group in five steps; join a group via
  invitation link/code)
- Authenticated dashboard structure: group selector, overview, and all
  eleven section pages with real, honest empty states
- Group-specific roles and a permissions/capability model
- Initial Postgres schema (17 tables) with Row Level Security covering
  every table
- Documentation set (this folder)
- `.env.example`, `.gitignore`, environment validation
- Automated tests for validation schemas, money helpers and the
  permissions model; production build, lint and tests all passing

## Phase 2 — Supabase authentication and group onboarding *(complete)*

- Connected a dedicated Supabase project; applied the Phase 1 migration,
  fixing three RLS bugs found during pre-deployment review (arbitrary
  self-join, self-promotion, audit log forgery — see
  [security-boundaries.md](./security-boundaries.md))
- Wired sign-up/sign-in/sign-out/password-reset/email-verification
  end-to-end against live Supabase Auth, using the PKCE flow and trusted
  (`getUser()`) session checks throughout
- Implemented the full invitation lifecycle: create (owner/admin only,
  hashed 256-bit token), view pending, revoke, copy-link-once, and a
  three-way acceptance flow (register / wrong-account / confirm-and-join)
  via the `accept_invitation()` database function
- Made group creation atomic via `create_group_with_setup()` — no
  sequential client-side inserts, no possibility of an ownerless or
  partially-created group
- Multi-group membership and switching, backed by real membership rows
- Audit logging for group/invitation lifecycle events

A manual, click-through smoke test (separate from the automated suites
above) confirmed the full flow end-to-end using two real accounts — see
[phase-2-smoke-test.md](./phase-2-smoke-test.md) for the detailed
results. It also surfaced and fixed a real bug (email confirmation was
vulnerable to link prefetching — see security-boundaries.md) and
identified the one item still genuinely unverified: a real "click the
email link" round trip, blocked this session by external email-delivery
obstacles unrelated to WealthCircle's code (documented in that file).

Deferred to a later phase, not part of Phase 2's explicit scope:
transactional email delivery of invitations (copy-link is implemented;
sending the email itself needs a provider decision — see
phase-2-smoke-test.md for what was tried), and a dedicated member
role-management UI (the RLS enforcement — including self-promotion
prevention — exists and is tested, but there's no "change someone's
role" screen yet).

## Phase 3 — Contributions and bank-statement reconciliation *(complete)*

- Contribution plan configuration (fixed or flexible, amount, optional
  required minimum for flexible plans, frequency) — extends the existing
  Settings page, currency is always inherited from the group and can
  never be mixed within it
- Contribution recording for treasurers/administrators/owners: member,
  amount, period, date received, payment method, bank/payment reference,
  internal note — always as a `pending_verification` ledger entry, never
  a money movement
- Verification and bank-statement reconciliation as two distinct steps
  (`pending_verification → verified → reconciled`), each stamping who and
  when
- Rejection (for a pending entry that was never actually received) and
  reversal/correction (for a verified or reconciled entry found to be
  wrong) as two separate workflows, both requiring a reason; a reversal
  never edits the original record — see
  [security-boundaries.md](./security-boundaries.md#contribution-ledger-integrity-phase-3)
- A database trigger, not just RLS, locks a verified/reconciled record's
  financial fields against direct edits
- Treasurer dashboard (expected/received/verified/pending/outstanding/
  overdue, fully-paid/partial/unpaid member breakdown, filters, recent
  activity) and a member-facing "My contributions" view, both computed
  server-side from RLS-scoped rows — never trusting a client-sent total
- Overdue detection (`src/lib/contribution-periods.ts`,
  `src/lib/contributions.ts`) handling partial payments, members who
  joined partway through a period, reversed contributions, flexible plans
  with no fixed target, and month-end/leap-year date-boundary edge cases
  — all as pure, unit-tested functions operating on plain `YYYY-MM-DD`
  strings rather than timezone-sensitive `Date` objects
- Tightened RLS: members can no longer create contribution records at
  all (only view their own); see security-boundaries.md for what changed
  from Phase 1's schema

Deferred to a later phase, not part of Phase 3's explicit scope:
**CSV export and a dedicated contribution report** — the current
roadmap places "reports... with export" in Phase 6, and building it
twice (once now, once properly alongside the other report types) wasn't
worth it. Bulk-import of contributions (mentioned as an original
possibility) was also deferred — single-entry recording covers the
actual requirement; bulk import can be added later without changing the
ledger model.

## Phase 4 — Loan applications and repayments *(complete)*

- Loan policy configuration (enabled/disabled, borrowing limit as a
  percentage of a member's verified contributions plus an optional hard
  ceiling, one-time flat interest rate, min/max repayment term,
  repayment frequency, optional grace period, whether members with
  overdue contributions/repayments remain eligible) — extends the
  existing Settings page and the Phase 1 `loan_products` table rather
  than a new table
- Server-side-only eligibility and borrowing-limit calculation from
  verified ledger data — a member's displayed maximum is advisory; the
  real limit is recomputed and enforced inside `apply_for_loan()` on
  every application, independent of anything the client sends
- Member loan application flow: verified contribution balance, maximum
  available loan, amount/term/purpose, a live interest and repayment
  preview, a declaration, one open application per member per group at a
  time (which also solves duplicate-submission-on-retry)
- Officer review queue: mark under review, approve (with editable terms
  distinct from what was requested — the difference is recorded) or
  reject, with structural self-approval prevention at both the RLS and
  RPC layers — see
  [security-boundaries.md](./security-boundaries.md#loan-ledger-integrity-phase-4)
- Disbursement recording as a distinct, explicit step — an approved
  loan sits `awaiting_disbursement` and only becomes `active` once an
  officer confirms the external bank transfer already happened; approval
  alone never activates a loan
- Repayment recording, verification and reconciliation consistent with
  the Phase 3 contribution ledger — proportional principal/interest
  allocation, partial/early/overpayment handling, rejection, and
  reversal-with-optional-replacement, all with the same immutability
  trigger pattern locking verified/reconciled records against direct edits
- Loan status tracking: `awaiting_disbursement`/`active`/`defaulted`/
  `cancelled` are the only stored states; "overdue" and "fully repaid"
  are computed server-side from the repayment schedule and verified
  repayments, never stored, avoiding a flag that could go stale
- Treasurer/loan-officer dashboards (applications awaiting review,
  awaiting disbursement, overdue loans, principal outstanding, interest
  expected/received) and a member-facing loan detail view (schedule,
  next repayment due, repayment history), both computed server-side from
  RLS-scoped rows

**A real Phase 1 RLS bug was found and fixed, not just extended**: the
original `loan_applications` update policy allowed decision-role OR
self, which meant an officer who was also the applicant could approve
their own request. See security-boundaries.md.

**Pre-launch requirement, not yet done**: appropriate UK legal and
regulatory review of the group lending model and all customer-facing
loan/interest wording, before any real group uses this feature.
WealthCircle must never be presented as a bank, credit union, or
regulated lender — this is a record-keeping layer for money that only
ever moves through a group's own external bank account.

## Phase 5 — End-to-end dashboard experience *(complete)*

An explicit, deliberate re-prioritisation by the product owner: rather
than starting withdrawals/governance next, Phase 5 consolidated the
already-built Phase 3/4 backend into three real, role-appropriate
dashboards — the first thing a signed-in member actually sees.
Withdrawals and governance move to Phase 6 (below), unchanged in scope,
just later in sequence.

- **Shared server-only calculation loaders**
  (`src/lib/data/contribution-summary.ts`,
  `src/lib/data/loan-summary.ts`) — the Contributions/Loans pages and
  the Overview dashboard now call the *same* functions rather than
  keeping parallel copies, so a number can never disagree between where
  it's first shown and where it's summarised
- **Treasurer dashboard** (Contributions page): a new `edit_contribution()`
  RPC lets a still-pending entry be corrected in place (amount, dates,
  method, reference, notes) without going through the reversal
  workflow — allowed only while `status = 'pending_verification'`,
  audit-logged like every other mutation; a new monthly contribution
  status table shows every active member's expected/verified amount,
  progress bar and status badge for the current period
- **Member dashboard** (group Overview, `member` role): current balance,
  total contributions, recent history, a missed-contributions list
  (every period since joining with status `overdue`, each with its
  shortfall), and a loan eligibility indicator using the exact same
  `computeEligibility()` result the apply-for-loan flow itself uses
- **Admin dashboard** (group Overview, officer roles — same
  `view_reports` capability check used elsewhere): active member count,
  overdue member count, expected/received/outstanding contributions,
  and a loan summary (active loans, principal outstanding, interest
  expected/received, applications awaiting review, overdue loans)
- Mobile-first pass across the new dashboard content, verified at phone
  width in the same guided walkthrough as every other phase

A guided, click-through walkthrough with a throwaway demo group
(cleaned up afterward, per the standing test-data policy) covered
editing a pending entry, the monthly status table, both new dashboards,
a full loan application → approval → disbursement cycle, and mobile
responsiveness — no bugs found in the new work. It did surface and fix
one pre-existing, unrelated cosmetic issue: a hydration console warning
on `/sign-in` caused by the Grammarly browser extension injecting
attributes into `<body>` before React hydrates — fixed by adding
`suppressHydrationWarning` to `<body>` (it already existed on `<html>`,
but that doesn't cascade to child elements); this suppresses only that
one node's attribute diff, not real mismatches elsewhere.

## Phase 6 — Withdrawals and governance *(complete)*

Builds on `withdrawal_requests`, `approval_requests`/`approval_decisions`,
`governance_proposals` and `votes` — all part of the Phase 1 schema but
never wired up until now. Three real Phase 1 gaps were fixed along the
way, not just extended: withdrawal requests could previously only be
inserted by a manager role, never by the member they're actually for;
the "two-person approval" was hardcoded via now-removed
`approved_by_1`/`approved_by_2` columns instead of the configurable
generic `approval_requests` pattern; and `votes` had no real access
control — any group member could read every other member's individual
vote at any time, including while voting was still open.

- **Withdrawal policy** (Settings): enabled flag, min/max amount, notice
  period before payment, whether partial withdrawals are allowed, which
  roles may review requests, how many approvals are required, whether
  overdue-contribution members remain eligible, whether members with an
  active loan are blocked outright, and an optional large-withdrawal
  threshold requiring a linked, passed governance proposal
- **Safe withdrawable-balance calculation**, server-side only
  (`request_withdrawal()`/`decide_withdrawal_request()`, mirrored for
  display in `src/lib/withdrawals.ts`): available = verified
  contributions − outstanding loan principal − amounts already reserved
  by open requests **or already paid out** — the loan-protection rule
  means a withdrawal can never leave a member's net verified
  contributions below their outstanding loan principal
- **Member withdrawal request flow**: available/reserved amount shown
  up front, plain-language "WealthCircle records but doesn't hold or
  transfer money" disclosure, one open request per member per group
  (the same duplicate-submission protection pattern used for loan
  applications), full lifecycle tracking, cancel while still pending
- **Configurable multi-approval lifecycle**: `draft/submitted/
  under_review/approved/rejected/cancelled/awaiting_payment/
  paid_externally/reversed`, routed through the generic
  `approval_requests`/`approval_decisions` pair so the required number
  of sign-offs is a per-group policy setting, not a fixed two — with the
  same self-approval prevention and one-decision-per-reviewer
  guarantees used elsewhere
- **External payment confirmation as a distinct, explicit step**:
  approval alone never marks a withdrawal paid — a reviewer must
  separately confirm the actual bank transfer (amount, date, reference,
  optional note) before the ledger permanently reflects it; reversal
  preserves the original record and requires a reason, the same
  immutability-trigger pattern as contributions and repayments
- **Governance**: proposal creation (any member) with title, description,
  category, voting window, optional quorum, and approval threshold;
  material terms locked once voting opens; one vote per eligible member
  (a database constraint, not just application logic); eligibility is a
  join-date-before-voting-opened comparison, the same point-in-time
  approach already used for contribution/loan eligibility; live
  individual votes and running tallies are visible only to owners,
  administrators and auditors while voting is open — everyone sees the
  full result once it closes
- **Officer and member dashboards**: Withdrawals page (officer queue +
  member request/lifecycle), Approvals page (cross-cutting queue of
  requests awaiting the signed-in officer's decision), and the group
  Overview page extended with Withdrawals/Governance stat groups for
  both admin and member views — all sourced from shared server-side
  loaders so numbers can never disagree between pages

A guided walkthrough with a throwaway demo group surfaced two real bugs,
both fixed and covered by new live security tests: (1) a member's
available balance never decreased once a withdrawal was actually paid
— only *open* requests were subtracted, so the same money could be
requested again — fixed in `supabase/migrations/
0012_fix_withdrawal_reserved_balance.sql`; (2) a plain member's
Governance page showed what looked like the complete vote tally while
voting was still open, when it was actually only their own vote
(correctly RLS-restricted, but misleadingly presented as if complete)
— fixed by gating the tally display on the viewer's actual visibility
rather than showing partial data unconditionally.

**The roadmap's original "financial correction workflow (reversal/
adjustment entries with mandatory reasons) surfaced in the UI" line is
delivered, not deferred** — via three domain-specific mechanisms rather
than one unified screen: `reverse_contribution()` (Phase 3),
`reverse_repayment()` (Phase 4), and `reverse_withdrawal_payment()`
(this phase). Each requires a mandatory reason, is locked behind the
same immutability trigger that protects verified/paid records from
direct edits, and has its own dedicated UI dialog. A focused post-Phase-6
gap analysis confirmed no code path anywhere has ever created an
`approval_requests` row with `subject_type = 'financial_correction'` —
that value has sat unused in the Phase 1 check constraint since the
initial schema. Building a fourth, unified version routed through it
would duplicate functionality the app already
delivers correctly, so no such workflow was built, and none is planned.

## Phase 7 — Member and role management *(complete)*

Closes the gap noted back in Phase 2: RLS-level protections against
self-promotion and unauthorised role changes have existed since Phase 2,
but there had never been a screen — or most of the RPCs — to actually
manage members or roles. A real, unfixed Phase 1 RLS gap was fixed here,
not just extended: the original `group_memberships_update_managers`
policy checked "is the actor a manager, and is the target not
themselves" for `USING`, but never checked the target row's *current*
role — so an administrator could in principle have demoted, suspended,
or removed an existing owner. No RPC ever exercised this (none existed
before this phase), but the policy itself was live and wrong. It's
replaced by two narrower policies (the same split-policy pattern used
for the Phase 4 loan self-approval fix): owner rows are now structurally
outside the reach of the general manage-members policy in both
directions, so this class of bug can't recur.

- **Member directory** (`supabase/migrations/
  0013_phase7_member_management.sql`): search, status tabs (Active /
  Invited / Suspended / Removed), mobile card layout below the usual
  breakpoint. Officers additionally see financial-obligation indicators
  (active loan, pending loan application, unverified repayment, pending
  withdrawal) and the most recent role/status-change event per member,
  sourced from `audit_logs`. Plain members keep the existing,
  unrestricted basic roster (name, role, status, joined date) —
  unchanged privacy model from Phase 1/2.
- **Role changes**: `change_member_role()` — manager-only, mandatory
  reason, rejects self-targeting, rejects assigning or changing away
  from `owner` (ownership only ever moves via the transfer workflow
  below), server-side recheck of current role/status on every call.
- **Suspend / reactivate**: group-scoped only. Suspension is enforced
  "for free" everywhere in the app — `is_group_member()`/
  `has_group_role()`/`is_group_manager()` (the Phase 1 helpers every RLS
  policy in the schema already calls) all filter on `status = 'active'`,
  so a suspended member loses both write *and read* access the instant
  their status changes, with no changes needed to any other table's RLS.
  Officers retain full visibility into a suspended member's history at
  all times.
- **Removal**: soft (`status = 'removed'`), blocked by unresolved
  obligations — an active loan, a pending loan application, an
  unverified repayment, a pending/approved withdrawal, or a pending
  ownership transfer involving them — via a shared
  `member_removal_blockers()` function that explains exactly what needs
  resolving first. An open governance proposal they created is shown as
  informational only, never a hard block, since a proposal doesn't
  depend on its proposer remaining a member.
- **Ownership transfer**: two-step (`initiate_ownership_transfer()` →
  target `accept_ownership_transfer()`/`decline_ownership_transfer()`,
  or the current owner `cancel_ownership_transfer()`), one pending
  transfer per group, 7-day expiry, no email notification (in-app only,
  per the phase boundary). The outgoing owner's role becomes
  `administrator` in the same transaction as the incoming owner's
  promotion — full continued authority, just no longer sole final
  authority.
- **Last-owner protection**: enforced structurally via
  `active_owner_count()`, used identically inside both an RLS
  `WITH CHECK` clause and RPC bodies — never counted in the browser. A
  sole owner cannot leave, and (as a consequence of the RLS fix above)
  cannot be demoted, suspended, or removed by anyone else either; the
  only way to change their status is to transfer ownership first.
- **Self-service leave** (Settings page): blocked by the same
  unresolved-obligations check as removal, and by last-owner protection.
- **Immutable audit records** for every role change, suspension,
  reactivation, removal, departure, and ownership-transfer event.

A guided walkthrough surfaced one real bug, fixed and covered by a new
live security test: `change_member_role()`, `suspend_member()`, and
`remove_member()` each looked up the target row with
`select ... for update` before deciding what to do. Under Postgres RLS,
`SELECT ... FOR UPDATE` must satisfy not only the `SELECT` policy but
also the `USING` clause of any applicable `UPDATE` policy — and the only
`UPDATE` policy covering these rows deliberately excludes `role =
'owner'`. So locking a target row that currently held `owner` silently
returned no row, and the code fell through to a generic "Member not
found in this group" instead of the intended "...owner cannot be
suspended/removed..." / "...ownership transfer workflow..." message.
The action was still correctly blocked either way (RLS did its job) —
this only fixed which error message the caller sees. Fixed in
`supabase/migrations/
0014_fix_member_management_owner_lock_visibility.sql` by dropping
`for update` from those three lookups (row locking isn't load-bearing
there; the later `update` statement still serializes concurrent writes
to the same row on its own).

## Phase 8 — Reports, notifications and audit tools *(complete)*

`notifications` and `audit_logs` have existed, unused and fully wired
respectively, since the Phase 1 schema. `audit_logs` was already
complete (every mutating RPC since Phase 2 writes to it); `notifications`
had never had a single row inserted by any code path before this phase.
Reports needed no new schema at all — they're computed live from
existing tables, reusing the same shared summary loaders the dashboards
already use (`contribution-summary.ts`, `loan-summary.ts`,
`withdrawal-summary.ts`) rather than recalculating totals a second way.

- **Group financial overview report**: verified/pending/outstanding
  contributions, overdue member count, loan principal outstanding,
  interest expected/received, withdrawal pending/paid totals, and a
  reversed/corrected-record count — filterable by date range, member,
  transaction type, status, and reconciliation state, with a filtered
  transaction table and CSV export. Gated to owner/administrator/
  treasurer/auditor specifically, not the broader `view_reports`
  capability — see "bugs found" below for why.
- **Member statement**: a WealthCircle ledger statement (explicitly not
  a bank statement, regulated credit statement, tax document, or
  financial advice) — opening/closing balance for a period (verified
  contributions minus paid withdrawals, computed live, never stored),
  contributions/withdrawals/loan disbursements/repayments/reversals in
  the period, pending transactions shown separately, and outstanding
  loans as a current snapshot. Members generate their own; officers with
  `view_reports` may generate any member's.
- **Specialist reports**: contribution/repayment arrears, reconciliation
  exceptions (verified but not yet reconciled), plus CSV exports for
  membership/role, governance proposals, and (for auditors) audit
  activity.
- **CSV export**: a Route Handler (not a Server Action — a real file
  download needs genuine HTTP response headers), formula-injection-safe
  (`src/lib/csv.ts` guards any cell starting with `=`, `+`, `-`, or `@`),
  every report regenerated server-side from the same loaders and
  filters as the on-screen version (never a client-supplied total),
  capped at 10,000 rows with a truncation notice, and logged as an
  `audit_logs` row (`report_export_generated`) before streaming.
- **Notification centre**: unread count, mark one/all read, pagination,
  filtering by group and category, safe links back to the relevant
  section page (never a record-specific URL — permission is always
  rechecked at the destination by that page's own normal auth/RLS path,
  the same guarantee Phase 7 established for suspension).
- **Notification events**: `create_notification()`, a narrowly-scoped
  `SECURITY DEFINER` helper (same justification as Phase 7's
  `member_removal_blockers`), called from every lifecycle RPC that
  should notify someone — invitation accepted/revoked/expired,
  contribution recorded/verified/rejected/reversed/overdue, loan
  submitted/approved/rejected/disbursed/overdue/fully repaid, repayment
  recorded/verified/rejected/reversed, withdrawal submitted/approved/
  rejected/paid/reversed, governance opened/deadline approaching/
  completed, ownership transfer initiated/accepted/declined/cancelled/
  expired, and every membership change from Phase 7. Idempotent via a
  `dedupe_key` column with a partial unique index, so retries and the
  reminder functions re-running can never create duplicate notifications.
- **Email notifications**: Mailtrap SMTP only (still dev-only), one
  shared accessible template with no amounts or specifics in the email
  itself — only a non-sensitive title and a sign-in link, with the full
  detail shown in-app after authentication. Postgres can't send SMTP, so
  delivery is a Next.js-layer side effect: `claim_pending_notification_emails()`
  (bounded to notifications whose recipient shares a group with the
  caller) and `mark_notification_email_result()` are the two narrow
  `SECURITY DEFINER` seams used for this — `SUPABASE_SECRET_KEY` still
  never appears anywhere under `src/`.
- **Notification preferences**: per-user, per-category, email-only (the
  in-app notification always exists regardless). `membership` and
  `ownership_transfer` are essential categories that always email,
  matching the "should not be silently disabled" requirement. Absence
  of a preference row means enabled, so existing users needed no
  backfill.
- **Scheduled reminders**: `send_overdue_contribution_reminders()`,
  `send_overdue_repayment_reminders()`, `send_governance_deadline_reminders()`,
  `expire_stale_invitations()`, `expire_stale_ownership_transfers()` —
  real, idempotent SQL functions, tested by calling them directly, not
  wired to an actual scheduler this phase (that's Phase 9's job:
  `pg_cron` or an external scheduler pointed at these).
- **Audit log viewer**: filterable by date range, actor, target type,
  and a derived "domain" (financial/governance/membership/etc.,
  computed from the existing `action` string, not a new column) —
  gated identically to the existing `audit_logs` RLS (owner/
  administrator/auditor only), so the viewer grants no access beyond
  what that policy already allows.

**Two real bugs found and fixed during live testing, both regressions
introduced by this phase itself** — see
[security-boundaries.md](./security-boundaries.md#notification-and-reporting-integrity-phase-8)
for the full detail:

1. The `accept_invitation()` and `request_withdrawal()`/
   `decide_withdrawal_request()` edits in the main migration were based
   on the *original* function bodies from `0002`/`0011`, not the
   already-corrected versions from `0004` (ambiguous-column fix) and
   `0012` (withdrawal-balance fix) — silently reintroducing both
   previously-fixed bugs. Caught immediately by the new live security
   tests; fixed in `0016_fix_accept_invitation_ambiguous_column_regression.sql`.
2. `contribution_records`' RLS (Phase 3) was never extended to
   `loan_officer`, but `loan_officer` has the `view_reports` capability
   — so the group financial overview would have silently shown
   RLS-truncated contribution totals to that role as if they were the
   complete group figures. Fixed by gating the overview specifically to
   the roles `contribution_records`' RLS actually covers
   (owner/administrator/treasurer/auditor), both on the page and in the
   export route handler, rather than the broader capability.

**Deferred, not part of this phase's scope**: document management
against Supabase Storage (present in the original one-line roadmap
bullet, but not part of the detailed Phase 8 spec actually approved —
treated as an intentional deferral rather than an oversight; revisit
only with an explicit decision).

## Phase 9 — Production hardening *(code complete; migration application, manual walkthrough, and several vendor decisions still pending — see [phase-9-smoke-test.md](./phase-9-smoke-test.md))*

- Closed the one open item carried from Phase 8: the officer-for-another-member
  statement export turned out to already work correctly — the real gap was
  that `report_export_generated` audit rows never recorded *which* member a
  statement was about, only who ran the export. Fixed by carrying
  `subject_member_id`/`subject_member_name` in the row's metadata for the
  statement branch specifically (`.../reports/export/route.ts`).
- **Scheduled jobs**: `/api/scheduler/run`, a bearer-secret-gated endpoint
  that calls the five idempotent reminder/expiry functions from Phase 8
  plus a notification-email flush — see
  [security-boundaries.md](./security-boundaries.md#production-hardening-phase-9)
  for the auth pattern (a dedicated, unprivileged Supabase Auth account, not
  `SUPABASE_SECRET_KEY`). The actual trigger mechanism (GitHub Actions
  cron / Vercel Cron / `pg_cron` / external scheduler) is a deployment
  decision, not made in code.
- **Email provider**: `MAILTRAP_*` renamed to generic `EMAIL_SMTP_*` —
  the code was already provider-agnostic (plain SMTP via nodemailer);
  only the variable names changed. Mailtrap remains the recommended
  *development* value; production needs a real transactional provider,
  a separate, cost-driven decision.
- **Rate limiting**: a Postgres-backed fixed-window limiter
  (`check_rate_limit()`, `0017_phase9_rate_limiting.sql`) covering
  invitation creation, the pre-auth invitation-preview flow, and CSV
  export — the surfaces that had no protection before this phase.
- **Security headers and CSP**: `next.config.ts` now sets a static CSP
  plus the standard hardening headers (HSTS, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy) on every
  route.
- **CSRF/session review**: confirmed, not changed — Server Actions
  already have Next's built-in Origin/Host CSRF check on by default,
  unoverridden; session cookie settings are `@supabase/ssr` defaults,
  also unoverridden.
- **Environment validation**: the new Phase 9 vars follow `src/lib/env.ts`'s
  existing fully-optional pattern (kept that way deliberately, since
  `next build` always runs with `NODE_ENV=production` internally
  regardless of deploy target — enforcing "required in production"
  inside that shared module would break every build, not just real
  deployments). A standalone `scripts/check-production-env.mjs`
  (`npm run check:production-env`) does that enforcement instead, run
  explicitly as a deployment-pipeline step.
- **CI**: `.github/workflows/ci.yml` — typecheck/lint/build/unit tests
  plus `npm audit` (warn-only) on every push/PR, needing no live
  credentials. The live security-test job is `workflow_dispatch`-only
  until a dedicated non-production Supabase project is approved for
  CI use.
- **Logging**: `src/lib/logger.ts` — the first error-visibility
  mechanism of any kind in this codebase; an error-reporting vendor
  hook exists but is a no-op until one is chosen.
- **Documentation deliverables**: `phase-9-backup-recovery.md`
  (Supabase backup/PITR options + a manual recovery-drill procedure),
  `phase-9-deployment-checklist.md` (vendor-agnostic staging/production
  checklists), and `legal-regulatory-review.md` (see restrictions
  below).

**Deliberately not done this phase, documented as known gaps** (see
[security-boundaries.md](./security-boundaries.md#production-hardening-phase-9)):
the five scheduled-job RPCs don't yet check caller identity internally
(low severity — each is idempotent and exposes only a count); edge/CDN-level
rate limiting isn't implemented (the Postgres-backed limiter is
right-sized for MVP traffic, not abuse-at-scale); no error-reporting
vendor is wired yet. **Document management** against Supabase Storage
remains deferred from Phase 8, unchanged — still requires an explicit
product-owner decision to pick back up.

**Decisions still needed from the product owner before the rest of this
phase can go live** (none made or assumed here — see
[phase-9-deployment-checklist.md](./phase-9-deployment-checklist.md)):
email provider + sender domain, scheduler trigger mechanism + run
frequency, hosting platform for staging/production, error-reporting
vendor, database backup/PITR tier, a dedicated non-production Supabase
project for CI, and Supabase session/refresh-token lifetime policy.

## Explicit restrictions (hold for every phase unless revisited with the user)

The following are out of scope for WealthCircle as currently defined and
must not be built without an explicit, separate decision by the product
owner: payment collection, Open Banking integration, automated bank
transfers, investment products, automated credit scoring, debit/credit
cards, cryptocurrency, international money transfers, claims of regulatory
authorisation, claims of deposit protection, fake testimonials,
hard-coded users, hard-coded financial transactions, hidden administrator
access, and production payment functionality of any kind. See
[product-brief.md](./product-brief.md) for the reasoning.

**Additional, explicit launch blocker (Phase 9):** a qualified UK
legal/regulatory opinion on the loan feature (FCA consumer credit
considerations) is required and has **not yet been obtained** — see
[legal-regulatory-review.md](./legal-regulatory-review.md). No group
should use lending functionality with real money and real members until
that review is complete, regardless of how much of the rest of Phase
9's technical checklist is finished.
