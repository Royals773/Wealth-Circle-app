# Phase 5 Manual Smoke Test

A manual, click-through verification of Phase 5 (end-to-end dashboard
experience), run the same way the Phase 2/3/4 smoke tests were — see
[phase-4-smoke-test.md](./phase-4-smoke-test.md) for that precedent.
Automated coverage ran and passed first; this record covers what a real
person clicking through a real browser confirmed on top of that.

## Automated results

- `npx tsc --noEmit` — pass
- `npm run build` — pass
- `npm run lint` — pass
- `npx vitest run` — 92/92 unit tests pass (no new pure logic was added
  in Phase 5 — the new work is entirely a UI/data-loader consolidation
  of already-tested Phase 3/4 calculations, plus one new RPC)
- `npm run test:security` — 60/60 live tests pass (56 pre-existing + 4
  new in `tests/security/contributions.test.ts` for `edit_contribution`:
  member cannot edit, owner can edit a pending record and the change
  persists, an owner from a different group cannot even see the record
  to edit it, and a reconciled record rejects the edit with a pointer to
  the reversal workflow instead) — against the real Supabase project
  after `0010_edit_pending_contribution.sql` was applied

## Manual walkthrough

Used two throwaway, clearly-labelled test accounts
(`wc-phase5-owner@example.com`, `wc-phase5-member@example.com`) in
"Phase 5 Demo Group", seeded with realistic (not placeholder) data: four
verified past contribution periods, one deliberately missed period
(April, to exercise the new missed-contributions view), and one pending
current-period entry recorded with a deliberately wrong amount (to
exercise the new Edit feature). Both accounts and the group were deleted
via a targeted script immediately after. No real financial information
was used.

| Step | Result |
|---|---|
| Treasurer: Edit button appears on a pending contribution row | ✅ Confirmed — dialog pre-filled with existing values |
| Treasurer: correcting the amount via Edit saves successfully | ✅ Confirmed |
| Treasurer: new monthly contribution status table shows correct expected/verified/progress/status per member | ✅ Confirmed |
| Treasurer: verifying the corrected entry updates the status table | ✅ Confirmed |
| Treasurer: member filter still works | ✅ Confirmed |
| Member dashboard (Overview): current balance, total contributions | ✅ Confirmed |
| Member dashboard: missed-contributions table shows the skipped period with correct shortfall | ✅ Confirmed |
| Member dashboard: loan eligibility card | ✅ Confirmed |
| Member dashboard: recent contributions list | ✅ Confirmed |
| Admin dashboard (Overview): active/overdue member counts | ✅ Confirmed (2 active, 1 overdue) |
| Admin dashboard: expected/received/outstanding contributions | ✅ Confirmed and cross-checked against the Contributions page's own Overview tab — exact match |
| Admin dashboard: loan summary starts at zero, then reflects a real application → approval → disbursement | ✅ Confirmed — active loans, principal outstanding and interest expected all updated correctly after disbursement |
| Mobile viewport (~390px): sidebar collapses to hamburger, stat cards stack, tables scroll in their own container | ✅ Confirmed on Overview and Contributions |

No bugs were found in the new Phase 5 work itself.

## Issue found and fixed (pre-existing, unrelated to Phase 5's new code)

A hydration console warning appeared on `/sign-in`:
`data-new-gr-c-s-check-loaded`/`data-gr-ext-installed` attribute
mismatch on `<body>`. Root cause: the Grammarly browser extension
injects those attributes into the DOM before React hydrates — the
error message itself names this as a known cause. `<html>` already had
`suppressHydrationWarning`, but that doesn't cascade to child elements;
added it to `<body>` too
(`src/app/layout.tsx`), which suppresses only that one node's attribute
diff and would not hide a real mismatch anywhere else. Confirmed gone
on refresh.

## Cleanup

Both test accounts and the demo group were deleted via a targeted,
non-bulk script immediately after this walkthrough, per the product
owner's explicit choice not to leave demo credentials in the live
project between sessions.

## Before Phase 6

1. **UK legal and regulatory review of the group lending model and all
   customer-facing loan/interest wording** — still not done, unchanged
   from Phase 4, still required before any real group uses the loans
   feature.
2. Continue using Mailtrap for development email only — swap for a
   production provider before real users, per
   [phase-2-smoke-test.md](./phase-2-smoke-test.md#before-phase-3--and-before-real-users).
3. The overdue-**repayments** check inside `apply_for_loan()` still uses
   a documented day-count approximation (only the overdue-contributions
   check was made exact, in the Phase 4 follow-up correction) — unchanged
   by Phase 5, still worth revisiting if real usage shows it disagreeing
   with the precise UI display.
4. "Received" on the Admin dashboard is an **all-time** total, while
   "Expected"/"Outstanding" alongside it are scoped to the **current
   period** — both definitions are correct and match the Contributions
   page's own long-standing Phase 3 definitions, but the juxtaposition
   on one dashboard reads as inconsistent at a glance. Worth a labelling
   pass (e.g. "Received (all time)") if this comes up in real use;
   deliberately not changed during Phase 5 since it wasn't reported as
   a defect, just observed during the walkthrough.
