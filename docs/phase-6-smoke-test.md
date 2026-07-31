# Phase 6 Manual Smoke Test

A manual, click-through verification of Phase 6 (withdrawals and
governance), run the same way the Phase 2-5 smoke tests were — see
[phase-5-smoke-test.md](./phase-5-smoke-test.md) for that precedent.
Automated coverage ran and passed first; this record covers what a real
person clicking through a real browser confirmed on top of that,
including two real bugs the automated suites couldn't have caught on
their own (both are now covered by new live security tests).

## Automated results

- `npx tsc --noEmit` — pass
- `npm run build` — pass
- `npm run lint` — pass
- `npx vitest run` — 123/123 unit tests pass (92 pre-existing + 31 new:
  `src/lib/withdrawals.test.ts`, `src/lib/governance.test.ts`)
- `npm run test:security` — 86/86 live tests pass (60 pre-existing + 26
  new: `tests/security/withdrawals.test.ts`,
  `tests/security/governance.test.ts`) — against the real Supabase
  project after `0011_phase6_withdrawals_governance.sql` and
  `0012_fix_withdrawal_reserved_balance.sql` were applied

## Manual walkthrough

Used three throwaway, clearly-labelled test accounts
(`wc-phase6-owner@example.com`, `wc-phase6-admin@example.com`,
`wc-phase6-member@example.com`) in "Phase 6 Demo Group", seeded with
£300 of verified contributions for the member and a withdrawal policy
requiring two approvals (owner + administrator). All three accounts and
the group were deleted via a targeted script immediately after. No real
financial information was used.

| Step | Result |
|---|---|
| Owner configures a withdrawal policy (2 approvals required) | ✅ Confirmed |
| Member sees available balance, submits a withdrawal request | ✅ Confirmed |
| Owner marks it under review, approves (1st of 2 approvals) | ✅ Confirmed |
| Administrator approves (2nd of 2) → moves to "Awaiting payment" | ✅ Confirmed |
| Owner confirms payment (bank reference, date) → "Paid" | ✅ Confirmed |
| Member sees "Paid" with the correct bank reference and date | ✅ Confirmed |
| Member's available balance decreases by the paid amount | ❌ → ✅ Bug found and fixed, see below |
| Member creates a governance proposal | ✅ Confirmed |
| Member votes "against" on their own group's proposal | ✅ Confirmed |
| Plain member's vote-tally view doesn't leak the real result | ❌ → ✅ Bug found and fixed, see below |
| Owner/administrator do see the full live tally | ✅ Confirmed after the fix |
| Mobile viewport (~390px): Withdrawals and Governance pages, dialogs | ✅ Confirmed |
| Overview dashboard: Withdrawals + Governance stat groups (admin) | ✅ Confirmed |
| Approvals page: correct empty state once nothing is pending | ✅ Confirmed |

One false alarm during the walkthrough, not a bug: a "Decide" dialog
appeared not to open on the first click. Reproduced with an automated
browser session twice (fresh load, and the exact reported sequence) —
both times it opened correctly on the first click. Traced to the dev
server actively hot-reloading from ongoing file edits during this exact
session; confirmed gone on retry once file changes stopped.

## Bugs found and fixed during this session

### Bug 1: a paid withdrawal never reduced the member's available balance

`request_withdrawal()` and `decide_withdrawal_request()` both computed
"amount already reserved" as the sum of only *open* requests
(`submitted`/`under_review`/`approved`/`awaiting_payment`). Once a
request reached `paid_externally`, it dropped out of that sum entirely
— it wasn't open, and nothing else subtracted it either. The member's
displayed and server-enforced available balance stayed at the full
verified-contributions figure even after £100 had actually been paid
out, meaning the same money could be requested (and, if a second
reviewer wasn't paying close attention, paid) again.

Found live: after confirming a £100 payment, the member's dashboard
still showed £300 available instead of £200. Fixed in
**`supabase/migrations/0012_fix_withdrawal_reserved_balance.sql`** —
idempotent (`create or replace function` only) — by including
`paid_externally` in the sum in both functions, alongside the matching
TypeScript-side fix in `src/lib/data/withdrawal-summary.ts`. Only a
genuine reversal (which flips status to `reversed`) releases the hold
again. Verified live after the fix: balance correctly showed £200.
Covered going forward by new assertions in
`tests/security/withdrawals.test.ts`.

### Bug 2: a plain member's "current tally" view was actually just their own vote

The Governance page let any signed-in member reveal a "current tally"
for an open proposal. Since the underlying `votes` query was already
correctly RLS-restricted (a plain member's `SELECT` on `votes` only
ever returns their own row while voting is open — see
[security-boundaries.md](./security-boundaries.md#governance-integrity-phase-6)),
what displayed was that member's single vote, formatted with a
for/against/abstain breakdown and a turnout percentage as if it were
the complete result. Not a data leak (the RLS restriction itself was
correct and unaffected) but a materially misleading presentation — a
member could see "For 0 · Against 1 · 33% turnout" and reasonably
conclude that's the real state of the vote, when it was only their own
ballot.

Found live: voted "against" as a plain member, then opened the tally
view and saw exactly this. Fixed by computing a `canSeeFullTally` flag
server-side in `governance/page.tsx` (owner/administrator/auditor —
mirroring the `votes_select_own_or_auditors` RLS policy exactly) and
having `ProposalCard` render a tally only when that's true or the
proposal has actually closed; otherwise it shows an explicit "results
stay private until voting closes" message. Verified live after the fix:
the member saw the private-results message; the owner, signed in
separately, saw the real tally. No RPC or RLS change was needed — this
was purely a client-side presentation bug built on top of correctly
scoped data.

## Cleanup

All three test accounts and the demo group were deleted via a targeted,
non-bulk script immediately after this walkthrough, per the same policy
established in Phase 5.

## Before Phase 7

1. **UK legal and regulatory review of the group lending model and all
   customer-facing loan/interest wording** — still not done, unchanged
   from Phase 4, still required before any real group uses the loans
   feature. Withdrawals remain a pure record-keeping feature (no money
   movement), so this requirement doesn't newly extend to them, but the
   review should still cover the full financial feature set before
   launch.
2. Continue using Mailtrap for development email only — swap for a
   production provider before real users, per
   [phase-2-smoke-test.md](./phase-2-smoke-test.md#before-phase-3--and-before-real-users).
3. The "financial correction workflow" line from the original roadmap's
   Phase 6 entry was deliberately not built — nothing in the codebase
   creates an `approval_requests` row with `subject_type =
   'financial_correction'` yet, so there was no real data source to
   build a UI against. Revisit if/when a concrete need for it emerges.
4. The Approvals page currently surfaces only `withdrawal_request`
   subject-type rows — the generic `approval_requests` table supports
   other subject types (`loan_application`, `governance_proposal`,
   `financial_correction`, `member_role_change`), but nothing currently
   creates rows for them. Worth revisiting once/if those flows route
   through the generic approval envelope instead of (or in addition to)
   their own dedicated RPCs.
