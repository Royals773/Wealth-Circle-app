# Phase 4 Manual Smoke Test

A manual, click-through verification of Phase 4 (loan applications and
repayments), run the same way the Phase 2/3 smoke tests were — see
[phase-3-smoke-test.md](./phase-3-smoke-test.md) for that precedent.
Automated coverage ran and passed first; this record covers what a real
person clicking through a real browser confirmed on top of that,
including two real bugs the automated suites couldn't have caught.

## Automated results

- `npm run build` — pass
- `npm run lint` — pass
- `npx vitest run` — 92/92 unit tests pass (64 pre-existing + 28 new:
  `loan-eligibility.test.ts`, `loans.test.ts`)
- `npm run test:security` — 43/43 live tests pass (25 pre-existing +
  18 new: `tests/security/loans.test.ts`), against the real Supabase
  project after `0007_phase4_loans.sql` and the follow-up
  `0008_fix_apply_for_loan_overdue_check.sql` were applied — including
  self-approval prevention (both the RPC check and the RLS layer
  independently), the eligibility-limit bypass attempt, cross-group
  isolation, the immutability trigger, and the full apply → review →
  approve → disburse → repay → verify → reconcile → reverse lifecycle

## Manual walkthrough

Used two throwaway, clearly-labelled test accounts
(`wc-phase4-owner@example.com`, `wc-phase4-member@example.com`) in
"Phase 4 Test Group", both deleted via a targeted script immediately
after. No real financial information was used.

| Step | Result |
|---|---|
| Settings → "Edit loan policy" appears, configure and save a policy | ✅ Confirmed |
| Plain member does not see the edit button | ✅ Confirmed (verified earlier in the Phase 3 pattern; not re-clicked here) |
| Member sees verified contribution balance and max available loan | ✅ Confirmed |
| Apply for a loan within the limit, with preview and declaration | ✅ Confirmed — see bug #1 below |
| Duplicate open application blocked with a clear message | ✅ Confirmed (covered by the live security suite; not re-clicked manually) |
| Requesting more than the eligible amount is rejected server-side | ✅ Confirmed (£180 request against a since-corrected limit) |
| Officer sees the application in the review queue, marks under review | ✅ Confirmed |
| Approve with adjusted terms (different from requested) | ✅ Confirmed — approved amount/rate correctly differed from the request and the loan's total repayable reflected the approved terms |
| Self-approval structurally prevented | ✅ Confirmed — no path to decide on your own application, even as owner/loan officer |
| Record disbursement → loan becomes "Active" | ✅ Confirmed |
| Record a partial repayment → "Pending verification" | ✅ Confirmed |
| Verify → reconcile, correct proportional principal/interest split | ✅ Confirmed exactly (£50 payment on a 250:262.50 loan → £47.61/£2.39) |
| Overpayment warning before submitting | ✅ Confirmed |
| Reject a pending entry with a reason | ✅ Confirmed |
| Reverse a reconciled entry (no replacement) — amount unchanged | ✅ Confirmed |
| Reverse a verified entry with a corrected replacement | ✅ Confirmed |
| Mobile viewport: stat cards stack, tables scroll in their own container, dialogs remain usable | ✅ Confirmed |

**Not separately re-clicked** (already covered by the live security
suite against two real accounts): duplicate-application blocking, a
plain member's Settings page hiding the loan-policy edit control.
**Skipped by mutual agreement**: a live overdue-loan scenario — already
covered by 10+ unit test cases in `loans.test.ts` (partial payments,
grace periods, early lump-sum payments, missed instalments).

## Bugs found and fixed during this session

### Bug 1: `apply_for_loan()`'s overdue-contributions check ignored when a member joined

The member's test account had verified contributions backdated to
January/February, but had only joined the group (per its real
`group_memberships.joined_at`) on the day of testing. The eligibility
*display* correctly used `computeMemberPeriodStatus`'s join-date
awareness and showed the member as eligible — but the server-side
enforcement inside `apply_for_loan()` used a simpler check ("is there a
verified contribution within roughly one period of today") that didn't
account for join date at all, and incorrectly rejected the application
with "Overdue contributions must be resolved."

This wasn't just the documented SQL approximation working as intended —
it was a real gap between what the UI promised and what the RPC
enforced. Fixed in
**`supabase/migrations/0008_fix_apply_for_loan_overdue_check.sql`** by
adding the same join-date awareness: a member is only evaluated for
overdue contributions once they've been a member for at least one full
repayment-frequency period. This migration is idempotent (a single
`create or replace function`) and was applied and confirmed before
re-running the live security suite (still 43/43 passing) and retrying
the application, which then succeeded.

### Bug 2: date columns caused SSR/client hydration mismatches

Reported as a "Recoverable Error" (React hydration mismatch) after a
hard refresh of the Repayments page: `30/07/2026` (server) vs.
`7/30/2026` (client) for the same date. Root cause: every table in the
app called `new Date(x).toLocaleDateString()` with no explicit locale,
so the rendered format depended on the *runtime's* default locale —
which differs between the Node.js server process and the browser. This
was a **pre-existing bug from Phase 1–3**, not something new to Phase 4
— it just hadn't been triggered/reported before. Found and fixed across
all 11 occurrences in the codebase (`contributions/page.tsx`,
`loans/page.tsx`, `members/page.tsx`, `contribution-records-table.tsx`,
`pending-invitations-list.tsx`, `repayments-table.tsx`) by passing an
explicit `"en-GB"` locale everywhere, matching `formatMoney()`'s
existing default. Re-ran build/lint/unit tests (still passing) and
confirmed with a hard refresh that the error was gone.

## Cleanup

Both test accounts and the test group were deleted via a targeted,
non-bulk script immediately after this walkthrough — confirmed via
script output. A brief mid-walkthrough script also gave the owner
account some verified contributions (needed to test self-application);
that account was included in the same final cleanup.

## Before Phase 5

1. **UK legal and regulatory review of the group lending model and all
   customer-facing loan/interest wording** — not yet done, and required
   before any real group uses this feature. WealthCircle must never be
   presented as a bank, credit union, or regulated lender.
2. Continue using Mailtrap for development email only — swap for a
   production provider before real users, per
   [phase-2-smoke-test.md](./phase-2-smoke-test.md#before-phase-3--and-before-real-users).
3. The overdue-members eligibility gate inside `apply_for_loan()` still
   uses a documented day-count approximation (now join-date-aware, but
   still not exact calendar period math) for the *contributions* and
   *repayments* overdue checks — worth revisiting if real usage shows it
   disagreeing with the precise UI display often enough to confuse
   officers.
