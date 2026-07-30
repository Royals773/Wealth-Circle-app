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

## Follow-up session: the two remaining manual checks

Two items from the original "Not separately exercised" list were
completed in a follow-up session, using a fresh throwaway owner account
(`wc-phase3-check2-owner@example.com`) and a plain member account
(`wc-phase3-check2-member@example.com`), both members of "Phase 3 Check2
Group", both deleted afterward via a targeted script.

| Step | Result |
|---|---|
| Plain member's Settings page hides "Edit contribution plan" | ✅ Confirmed — the button and the entire edit section are simply absent for the member account; only the read-only summary shows |
| Save a flexible plan with no minimum | ✅ Confirmed |
| Save a flexible plan with a minimum amount | ✅ Confirmed — see bug below |

### Bug found and fixed: plan edits weren't reflected anywhere

While checking the flexible-with-minimum save, the user reported the
"Edit contribution plan" button becoming unresponsive after saving.
Reproduced independently with a headless-browser script (Playwright,
installed temporarily and removed afterward — never added to
`package.json`) covering both a fresh page load and a browser
back-button return: **no defect in the save/edit flow itself** — the
value persisted correctly every time (verified by re-reading the actual
input value after reopening the form, not just its visible label), and
no console errors occurred either way.

The real issue, once the user reframed it as "where do my changes
appear": **`settings/page.tsx`'s "Contributions" summary card displayed
the group's creation-time defaults (`groups.contribution_frequency`/
`contribution_type`) and never reflected the actual active
`contribution_plans` row that `ContributionPlanForm` edits.** A treasurer
could save a plan change and see the page still showing the old
frequency/type, with no visible confirmation the edit had taken effect
anywhere except by reopening the edit form itself. This affected every
role, not just the one being tested — a plain member viewing the same
page would also see stale information.

Fixed by loading the active plan for every viewer (not just managers)
and displaying its live values — frequency, type, and amount or required
minimum — directly in that card, with the group's original description/
country/financial-year fields left as they were. Verified with the same
headless-browser script: saving a fixed plan of £42.50 now shows "Type:
Fixed" and "Amount each period: £42.50" in the card immediately, no
reopening required. Re-ran the full suite afterward — build, lint, 64
unit tests, 25 live security tests — all still pass.

**Filter note** (from the original session): filtering by status
"Reconciled" appeared to show nothing partway through that walkthrough,
which looked like a bug — it wasn't. The one record that had reached
"Reconciled" had since been reversed (an earlier, deliberate step in the
same checklist), so no record currently held that status; the filter was
returning the correct, empty result.

## Cleanup

All test accounts and groups from both sessions were deleted via
targeted, non-bulk scripts immediately after use, matched by exact
email — confirmed via script output each time. No temporary scripts
remain in the repository; the temporarily-installed `playwright` package
used only for the headless-browser reproduction was removed with
`npm uninstall --no-save`, never added to `package.json` or
`package-lock.json`.

## Before Phase 4

Continue using Mailtrap for development email only — swap for a
production provider before real users, per
[phase-2-smoke-test.md](./phase-2-smoke-test.md#before-phase-3--and-before-real-users).
No other known gaps remain from Phase 3's manual checklist.
