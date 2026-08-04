# Phase 10 Planning — Production Readiness

Status: **preparation only**. No production infrastructure exists yet.
This document records decisions made so implementation (a later, separate,
gated step) has something fixed to build against — it is not itself an
implementation record. See [phase-10-readiness-audit] (this session's chat
history — not yet a standalone doc) for the full blocker/required/deferred
categorisation this plan works from.

## Decision 1 — Lending stays disabled pending legal review

Resolves the open question in
[legal-regulatory-review.md](./legal-regulatory-review.md): lending
functionality (loan applications, approvals, disbursements, repayments,
interest, and any lending-related public-facing wording) will be
**technically disabled by a feature flag, off by default**, for all real
users, until a written UK legal/regulatory opinion is obtained and
recorded in that document. This is stricter than "simply unused" — the
flag is enforced at the database layer (RLS/RPC), not just hidden in
the UI, so it holds even against a direct API call. Existing loan code
is not removed; the flag is designed to be a single, reversible switch.
Full design (table, function, every affected RPC/route/nav item/page)
was presented and is pending approval before implementation.

## Decision 2 — Reports-page role-based access policy

Replaces the current single `view_reports` capability gate (which
currently lets any role holding it see the same group financial
overview, already found once to be too broad for `loan_officer` — see
`security-boundaries.md`'s Phase 8 section) with a report-type-specific
policy:

| Role | Access |
|---|---|
| Owner, Administrator | Full group-wide reports and CSV exports |
| Treasurer | Full contribution, repayment and financial reports/exports |
| Auditor | Read-only access to all group-wide reports/exports; no mutation rights (already true — auditor has no write capability anywhere) |
| Loan Officer | Only loan and repayment reports/exports — no unrelated member savings/contribution data |
| Member | Only their own contributions, repayments, loans and personal statement — never other members' records or group-wide exports |
| Invited / suspended / removed | No report access |

**Enforcement requirement**: server-side authorization and RLS/RPC
boundaries are the actual enforcement point — hiding UI controls alone
is explicitly insufficient, consistent with this project's standing
"RLS is the real boundary, `permissions.ts` is convenience only" rule.
Report exports must continue to create `audit_logs` rows
(`report_export_generated`), unchanged from the existing Phase 8/9
behaviour. New tests required before this is considered done:
tenant-isolation (a report never leaks another group's data), per-role
access (each row of the table above proven both ways — allowed and
denied), and export-specific access (CSV route handler enforces the
same boundary as the on-screen version, not a separate, weaker check).

**Not yet implemented.** This is a recorded decision for a later gated
step — no RLS policy, RPC, or page code has been changed for this yet.

## Decision 3 — Production Supabase project

**Confirmed**: production will use a **brand-new, isolated Supabase
project** — never the staging project, never the original Phase
1–9 development project. Same reasoning as staging's own isolation
decision: the original project has accumulated test-account/group
residue across nine phases of manual walkthroughs (documented in every
phase's own smoke-test file), and a financial-record-keeping app
launching real users deserves a genuinely clean starting database, not
a cleaned-up development one. **Not yet created.**

## Production Supabase creation checklist, with manual decisions and expected costs

Every row below is either a **decision** (yours to make, not assumed
here) or a **cost** (a real, ongoing or one-time expense, flagged
explicitly rather than silently incurred).

1. **Create the project.** *Decision*: region (affects latency for the
   target user base — not yet known/assumed). *Cost*: Supabase **Pro
   tier minimum** (required for backups — see step 8); Supabase's own
   published pricing applies, not estimated here since it can change —
   confirm current pricing on Supabase's site before committing.
2. **Apply migrations 0001–0018 in order**, full-file paste via SQL
   Editor, independently verified after each (query
   `information_schema`/`pg_proc` directly — this session twice caught
   a migration that reported "Success" but hadn't actually applied).
3. **Row/function/policy count verification** against staging's known
   values, before any test data touches the project.
4. **Run the full `tests/security` live suite** (136 tests) against
   this project — must match staging's pass rate before proceeding.
5. **Supabase Auth custom SMTP.** *Decision*: which production email
   provider (see item 6 — same provider likely serves both). *Cost*:
   provider-dependent (Postmark/SES/SendGrid/Resend/Mailgun all have
   different pricing models — not chosen or estimated here).
6. **App `EMAIL_SMTP_*` production credentials**, same provider as
   item 5, with SPF/DKIM/DMARC verified on the sending domain before
   any real send. *Decision*: sender domain.
7. **Session/refresh-token lifetime policy.** *Decision*: a
   UX-vs-exposure trade-off, Supabase Dashboard setting, currently
   unset by explicit choice (still Supabase's default) — must be
   decided deliberately for production, not left as an accidental
   default.
8. **Backups.** *Decision*: confirm Pro-tier daily backups are active
   the moment the project exists, before any real row is written.
   *Cost*: included in Pro tier; **Point-In-Time Recovery is a
   separate paid add-on on top of Pro** — tier/retention window
   (7/14/30 days) is a cost decision, recommended minimum once real
   financial data exists per `phase-9-backup-recovery.md`.
9. **Recovery drill**: run once against this project specifically
   (restore to a fresh throwaway project, verify row counts and that
   RPCs/RLS still work, record actual time taken) before real users.
10. **Scheduler account**: create the dedicated memberless Supabase
    Auth account, grant `scheduler_capabilities` via SQL Editor only
    (service-role key never touched by any script, per this session's
    established pattern), generate a fresh `SCHEDULER_SECRET`.
    *Decision*: production scheduler trigger mechanism (GitHub
    Actions / Vercel Cron / `pg_cron`) and run frequency — see the
    Vercel investigation for why the git-push path needs fixing first
    if that's the chosen mechanism.
11. **CI security-tests project.** *Decision*: whether this new
    production project is ever used for CI (recommended: **no** —
    provision a fourth, separate non-production project for CI
    specifically, so CI never has any credential capable of touching
    real user data). *Cost*: a second small Supabase project if that
    recommendation is taken — likely usable on the Free tier, since CI
    fixtures are throwaway and don't need backups.
12. **Environment variables**: a fully separate credential set in
    Vercel's Production scope — every value independently generated,
    none copied from staging.
13. **Final gate**: repeat the full Phase 9 smoke-test walkthrough
    against this project before the first real group is created on it.

## Open items this plan does not resolve

- Production domain/DNS (a cost + decision, not addressed here)
- Vercel Production Branch setting and the still-broken git-push-to-deploy
  path (see this session's Vercel investigation — needs a decision on
  GitHub App reconnection before it can be relied on)
- Error-monitoring vendor, hosting/monitoring costs
- The Reports-page RBAC policy above is decided but not implemented
- The lending feature flag is designed but not implemented
