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

Deferred to a later phase, not part of Phase 2's explicit scope:
transactional email delivery of invitations (copy-link is implemented;
sending the email itself needs a provider decision), and a dedicated
member role-management UI (the RLS enforcement — including
self-promotion prevention — exists and is tested, but there's no "change
someone's role" screen yet).

## Phase 3 — Contributions and bank-statement reconciliation

- Contribution recording UI for treasurers (single entry + bulk import)
- Member-facing "my contributions" view
- Verification workflow (submitted → verified)
- Bank-statement reconciliation workflow (verified → reconciled), always
  capturing who reconciled a record and when
- Overdue detection for missed contributions against a plan's schedule

## Phase 4 — Loan applications and repayments

- Loan product configuration for loan officers
- Member-facing loan application flow
- Loan officer review/approval workflow
- Disbursement recording (record-keeping only — no funds movement)
- Repayment recording, verification and reconciliation
- Loan status tracking through to paid/overdue/defaulted

## Phase 5 — Withdrawals, dual approval and governance

- Withdrawal request flow with mandatory two-person approval for groups
  that require it
- Generic `approval_requests`/`approval_decisions` workflow surfaced in
  the Approvals page for all sensitive-action types
- Governance proposal creation, voting, and recorded outcomes
- Financial correction workflow (reversal/adjustment entries with
  mandatory reasons) surfaced in the UI

## Phase 6 — Reports, notifications and audit tools

- Period reports (contributions, loans, group financial summary) with
  export
- Real-time notifications for approvals, invitations and governance events
- Audit log viewer for auditors/owners/administrators
- Document management against Supabase Storage

## Phase 7 — Production security, testing and launch

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
