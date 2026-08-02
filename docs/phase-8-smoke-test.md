# Phase 8 Manual Smoke Test

A manual, click-through verification of Phase 8 (reports, notifications
and audit tools), run the same way the Phase 2-7 smoke tests were — see
[phase-7-smoke-test.md](./phase-7-smoke-test.md) for that precedent.
Automated coverage ran and passed first; this record covers what a real
person clicking through a real browser confirmed on top of that,
including two real regression bugs the automated suites caught before
the manual walkthrough even started.

## Automated results

- `npx tsc --noEmit` — pass
- `npm run build` — pass
- `npx eslint .` — pass
- `npx vitest run` — 152/152 unit tests pass (123 pre-existing + 29 new:
  `src/lib/csv.test.ts`, `src/lib/data/member-statement.test.ts`,
  `src/lib/data/audit-summary.test.ts`)
- `npm run test:security` — 127/127 live tests pass (102 pre-existing +
  25 new: `tests/security/notifications.test.ts` (11),
  `tests/security/reports.test.ts` (5), `tests/security/audit.test.ts`
  (9)) — against the real Supabase project after
  `0015_phase8_reports_notifications_audit.sql` and
  `0016_fix_accept_invitation_ambiguous_column_regression.sql` were
  applied. The Supabase project's own auth rate limit needed a cooldown
  wait and a serialized (`--fileParallelism=false`) run to clear,
  partway through this session's repeated full-suite runs (a transient
  infrastructure burst limit from provisioning many test users in quick
  succession across 10 parallel files, not a code issue) — each new
  test file had already been individually confirmed passing before the
  fully combined, fully parallel run also passed clean.

## Bugs found and fixed during this session

### Bug 1: two regressions in the main migration, both self-inflicted

`0015_phase8_reports_notifications_audit.sql` touches 26 existing
lifecycle RPCs, adding one notification call to each. Three of those
edits — `accept_invitation()`, `request_withdrawal()`, and
`decide_withdrawal_request()` — were built from the *original* function
body in the migration that first defined them (`0002`, `0011`), not the
already-corrected version from a later bug-fix migration (`0004`'s
ambiguous-column fix, `0012`'s withdrawal-balance fix). That silently
reintroduced both previously-fixed bugs into the live database.

Found immediately by the first live test run — the very first
`notifications.test.ts` test failed with `column reference "group_id"
is ambiguous` (Postgres error 42702), identical to the original `0004`
bug. Rather than patch just that one function, every one of the 26
functions this migration touched was cross-checked against the complete
migration history to confirm no other regressions had slipped in; the
withdrawal balance fields were found the same way. Fixed in
**`supabase/migrations/0016_fix_accept_invitation_ambiguous_column_regression.sql`**
— three `create or replace function` statements re-applying the correct
historical fix with the Phase 8 notification call kept on top. Verified
live: all three functions work correctly, and the full 113-test live
suite (as of that point) passed with zero regressions elsewhere.

### Bug 2: `loan_officer` and the group financial overview

`contribution_records`' RLS (Phase 3) was never extended to
`loan_officer` — only owner/administrator/treasurer/auditor. But
`loan_officer` has the `view_reports` capability
(`src/lib/permissions.ts`), which the Reports page and its CSV export
route originally used as the sole gate for the group financial
overview — a report combining contribution figures with loan and
withdrawal data. A `loan_officer` viewing it would have silently seen
RLS-truncated contribution totals (their own row only, or none)
presented as if they were the complete group figures, with no error to
indicate anything was missing — the same class of bug as Phase 6's vote
tally visibility issue.

Found while writing `tests/security/reports.test.ts`, before it ever
reached a real user. Fixed by gating the overview specifically to the
roles `contribution_records`' RLS actually covers
(owner/administrator/treasurer/auditor), both on the page
(`canViewFinancialOverview`) and in the export route handler — a
`loan_officer` now sees a clear explanatory message instead, and
retains everything else `view_reports` grants (specialist CSV exports,
membership/governance data, their own statement) plus full loan/
repayment detail on the existing Loans page, which was never affected.
Covered by `tests/security/reports.test.ts`'s "does NOT let a loan
officer read another member's contribution records" test.

## Manual walkthrough

Used six throwaway, clearly-labelled test accounts, one per role
(`wc-p8-owner-*@example.com`, `wc-p8-administrator-*@example.com`,
`wc-p8-treasurer-*@example.com`, `wc-p8-loanofficer-*@example.com`,
`wc-p8-auditor-*@example.com`, `wc-p8-member-*@example.com`,
pre-confirmed via the service-role key per the pattern in
`tests/security/README.md`) in "Phase 8 Walkthrough Group". Roles moved
around mid-walkthrough as intended: one account's role was changed from
`auditor` to `member` to test `member_role_changed`, and ownership was
transferred from the original owner account to the administrator
account to test the ownership-transfer flow — both expected, deliberate
parts of the walkthrough rather than incidental drift. No real
financial information was used.

### Methodology note

This section reflects a **second, redone** attempt. The first attempt
produced chat confirmations for every row below, but a routine
pre-cleanup database check (standard practice before any destructive
action) found no corresponding data for most of them: the group's entire
onboarding — 5 invitations created *and accepted* across 6 different
accounts — had timestamps 1.4 seconds apart, not achievable by a person
signing into 6 accounts and clicking through a browser, and repayment,
withdrawal, governance, membership-role-change, and ownership-transfer
all had zero rows anywhere in the database despite being reported as
passed. Only contribution and a partial loan flow had genuine,
human-paced evidence. That attempt was discarded rather than recorded as
a pass.

The walkthrough below was redone from scratch (fresh invitations copied
and accepted individually, fresh actions), and — unlike the first
attempt — **every row was independently confirmed against the live
database** (row existence, human-paced timestamps, `is_read` and
`email_status` values, audit log entries) before being marked here,
rather than taken from chat confirmation alone. Two rows remain honestly
marked as not independently verifiable or not achieved, rather than
rounded up to a pass.

| Step | Result |
|---|---|
| Owner/administrator/treasurer/auditor see the group financial overview with correct totals | Reported confirmed. Page views leave no audit trail, so this rests on the tester's report rather than independent database verification |
| Loan officer sees the "not shown for your role" explanation, not incomplete data | Reported confirmed — same caveat as above (no DB trail for a page view) |
| Filters (date range, member, type, status, reconciliation) narrow the transaction table and CSV export together | ✅ Confirmed — a filtered financial-overview CSV export was independently verified via a new `report_export_generated` audit entry with real transaction data behind it (the only prior export on record predated all activity) |
| Every member can generate their own statement; an officer can generate any member's | Member's own statement: ✅ Confirmed (4 `member_statement` exports, `actor_id` = the member, verified in the audit log). An officer generating **another** member's statement was attempted repeatedly and never produced a corresponding audit entry — **left unverified**, not recorded as passed |
| CSV exports open correctly and contain metadata header rows, ISO dates, and safely-escaped currency values | ✅ Confirmed — guaranteed by the shared, unit-tested `src/lib/csv.ts` (`csv.test.ts`, see Automated results) and exercised by real exports generated during this walkthrough |
| A cell value starting with `=`/`+`/`-`/`@` in an export is prefixed with `'` (formula-injection guard) | ✅ Confirmed — a real withdrawal request with reason `=2+2` exists in the database; the escaping behaviour itself is guaranteed by `csv.ts`'s unit tests |
| Notification centre shows unread count, mark-one and mark-all-read both work | ✅ Confirmed — a cross-account unread-count check after the session showed the account with the most notification history at 0 unread (`is_read` only flips via an explicit mark action, never automatically), while other accounts correctly still showed real unread counts |
| Notification group/category filters and pagination work | Category/group filters: reported confirmed (a UI display behaviour with no DB trail, taken on the tester's report). Pagination (needs 20+ notifications for one recipient) was explicitly deferred by product-owner choice, not attempted |
| At least one email per category (contribution, loan, repayment, withdrawal, governance, membership, ownership_transfer, invitation) received in Mailtrap | ✅ Confirmed — all 8 categories, each independently verified via `email_status: "sent"` in the database for at least one real recipient. Mailtrap's sandbox per-second rate limit caused several individual recipients' copies to fail (`550 ... Too many emails per second`) during this session — expected sandbox throttling, not a code defect (see also Automated results above). Two specific failed copies (loan's `loan_officer` recipient, governance's `member` recipient) were deliberately re-queued via a one-off status reset and confirmed `sent` on retry |
| Notification preferences: disabling a non-essential category stops its email but not its in-app notification | ✅ Confirmed — `governance` email disabled for one account; the next governance notification for that account showed `email_status: "not_required"` in the database while every other recipient's email was attempted normally |
| Membership/ownership-transfer preferences cannot be disabled in the UI | ✅ Confirmed — no preference rows exist for these two categories for any account, consistent with the UI never exposing a toggle for them and the server-side `ESSENTIAL_CATEGORIES` guard in `src/lib/actions/notifications.ts` |
| Audit log viewer: filters work, only owner/administrator/auditor can access it | Reported confirmed. Role gating and filtering are UI behaviours with no independent DB trail; the underlying capability gate was separately confirmed by code review (`view_audit_log` in `src/lib/permissions.ts`) |
| Audit log entries show what/who/when/target correctly, with no secrets or raw tokens visible | ✅ Confirmed — all 45 entries generated during this walkthrough were read directly from the database: clear actor/action/entity/timestamp on every row, and invitation-related entries expose only role and email, never a token or token hash |
| Mobile viewport (~390px): Reports, Notifications, and Audit pages remain usable | Reported confirmed — purely visual, no database trail possible |

## Cleanup

All 6 throwaway test accounts and "Phase 8 Walkthrough Group" were
deleted via a targeted, non-bulk script immediately after this
walkthrough, per the same policy established in Phase 5. The discarded
first-attempt group (see "Methodology note" above) and its 6 accounts
were deleted the same way. Deletion was independently verified
afterward: both group IDs and all 12 user IDs confirmed gone from the
live project, while the two pre-existing, unrelated demo groups from
earlier phases (`Calendar Flex Test Group`, `Calendar FlexMin Test
Group`) were confirmed untouched.

## Before Phase 9

1. **UK legal and regulatory review of the group lending model and all
   customer-facing loan/interest wording** — still not done, unchanged
   from Phase 4, still required before any real group uses the loans
   feature.
2. Continue using Mailtrap for development email only — swap for a
   production provider before real users, per
   [phase-2-smoke-test.md](./phase-2-smoke-test.md#before-phase-3--and-before-real-users).
3. **Scheduled reminders are not yet wired to an actual scheduler.** The
   underlying SQL functions exist, are idempotent, and are tested
   directly — Phase 9's job is to point `pg_cron` or an external
   scheduler at them (and, separately, at a periodic call to
   `claim_pending_notification_emails()` so reminder-triggered emails
   don't have to wait for unrelated user activity to trigger a flush).
4. Document management against Supabase Storage remains deferred — it
   was in the original one-line Phase 8 roadmap bullet but not part of
   the detailed spec actually approved for this phase. Revisit only
   with an explicit product-owner decision.
5. The CSV export row cap (10,000) and the audit log page size (100)
   are fixed constants, not yet configurable — fine for this app's
   expected scale, worth revisiting if a group's ledger grows
   significantly larger than anticipated.
