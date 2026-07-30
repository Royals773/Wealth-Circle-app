# Phase 3 Manual Smoke Test

A manual, click-through verification of Phase 3 (the contribution
ledger), run the same way the Phase 2 smoke test was — see
[phase-2-smoke-test.md](./phase-2-smoke-test.md) for that precedent.
Automated coverage ran and passed first (see below); this record covers
what a real person clicking through a real browser confirmed on top of
that — does the UI actually work, is it usable on mobile, does an
officer's real workflow make sense end to end.

## Automated results

- `npm run build` — pass
- `npm run lint` — pass
- `npx vitest run` — 64/64 unit tests pass (36 pre-existing + 28 new:
  `contribution-periods.test.ts`, `contributions.test.ts`)
- `npm run test:security` — 25/25 live tests pass (13 pre-existing +
  12 new: `tests/security/contributions.test.ts`), against the real
  Supabase project after `0006_phase3_contributions.sql` was applied

## Manual walkthrough

Used one throwaway, clearly-labelled test account
(`wc-phase3-test@example.com`, owner of "Phase 3 Test Group"), created
via a temporary, gitignored setup script and deleted — along with the
group — via a second temporary script immediately after, matched by
exact email, not a bulk delete. No real financial information was used.

| Step | Result |
|---|---|
| Settings → "Edit contribution plan" button appears, configure a fixed plan, save | ✅ Confirmed |
| Contributions page shows "Overview" and "My contributions" tabs | ✅ Confirmed |
| Record a contribution → appears as "Pending verification" | ✅ Confirmed |
| Verify → status becomes "Verified" | ✅ Confirmed |
| Reconcile → status becomes "Reconciled" | ✅ Confirmed |
| Record a second entry, Reject it with a reason → "Rejected", no further actions | ✅ Confirmed |
| Reverse a reconciled entry (no replacement) → "Reversed", amount unchanged | ✅ Confirmed |
| Reverse a verified entry **with** a corrected replacement → new "Pending verification" row with the corrected amount, original stays "Reversed" | ✅ Confirmed |
| Filter the ledger by member/status/date range | ✅ Confirmed — see note below |
| "My contributions" tab shows verified total, pending amount, expected/outstanding, full history including reversals | ✅ Confirmed |
| Mobile viewport: stat cards stack, ledger table scrolls in its own container, dialogs remain usable | ✅ Confirmed |

**Filter note**: filtering by status "Reconciled" initially appeared to
show nothing, which looked like a bug — it wasn't. By that point in the
walkthrough the one record that had reached "Reconciled" had since been
reversed (an earlier, deliberate step in this same checklist), so no
record currently held that status. The filter was returning the correct,
empty result.

**Not separately exercised in this walkthrough** (single-account test
group, so nothing to click through for these — already covered by the
automated live security suite instead):
- A plain member's Settings page correctly hiding "Edit contribution
  plan" — enforced by `roleHasCapability` + the RLS policy on
  `contribution_plans`, and covered by
  `src/lib/permissions.test.ts` and the RLS-focused live tests.
- One member being structurally unable to see another member's
  contribution records — this is exactly what
  `tests/security/contributions.test.ts`'s "lets a member see only their
  own contribution records, not the group's whole ledger" test verifies
  directly against two real accounts.
- Flexible / flexible-with-minimum plan configuration — covered by
  `src/lib/validations/contributions.test.ts`-style schema validation
  (via `contribution-periods.test.ts`/`contributions.test.ts`'s coverage
  of the flexible-plan overdue logic) rather than a manual click; worth a
  quick manual check before real users, low risk given the automated
  coverage.

## Cleanup

The test account and group were deleted via a targeted, non-bulk script
immediately after this walkthrough — confirmed via script output
(`deleting group: Phase 3 Test Group ...` / `deleting test user:
wc-phase3-test@example.com`).

## Before Phase 4

1. Manually click through the flexible/flexible-with-minimum plan
   configuration once, and the "member without treasurer capability sees
   a restricted view" case with a second real account — both low-risk
   given existing automated coverage, but not yet clicked by a human.
2. Continue using Mailtrap for development email only — swap for a
   production provider before real users, per
   [phase-2-smoke-test.md](./phase-2-smoke-test.md#before-phase-3--and-before-real-users).
