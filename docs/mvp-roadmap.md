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

## Phase 6 — Withdrawals, dual approval and governance

- Withdrawal request flow with mandatory two-person approval for groups
  that require it
- Generic `approval_requests`/`approval_decisions` workflow surfaced in
  the Approvals page for all sensitive-action types
- Governance proposal creation, voting, and recorded outcomes
- Financial correction workflow (reversal/adjustment entries with
  mandatory reasons) surfaced in the UI

## Phase 7 — Reports, notifications and audit tools

- Period reports (contributions, loans, group financial summary) with
  export
- Real-time notifications for approvals, invitations and governance events
- Audit log viewer for auditors/owners/administrators
- Document management against Supabase Storage

## Phase 8 — Production security, testing and launch

- Full RLS policy review and penetration-style testing of tenant isolation
- Rate limiting, dependency/security scanning, CI hardening
- Expanded automated test coverage (integration + end-to-end)
- Accessibility audit beyond the Phase 1 spot checks
- Real pricing, billing integration decisions, and production deployment

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
