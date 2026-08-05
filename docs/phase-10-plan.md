# Phase 10 Plan — Pre-Work Status

**Phase 10 implementation has not started.** Everything below is
preparation: verifying the staging deployment pipeline actually works
and closing out test-coverage gaps identified in the Phase 10
readiness audit, before any real Phase 10 feature work begins. Two
external blockers (bottom of this doc) remain open regardless of how
much of the technical checklist below is done.

## Steps 1–5: staging pipeline and test-coverage verification

All five completed against the live staging Supabase project and the
live, Deployment-Protection-gated Vercel staging deployment — nothing
here touched `main`, production, or any real user.

1. **Git state verified** before every push (`git status`,
   `git log origin/staging..staging --oneline`) — clean tree, exactly
   the expected commits ahead, every time. ✅ Done.
2. **Push-to-deploy validated**: `staging` pushed to `origin/staging`
   and confirmed to trigger a real Vercel deployment automatically —
   **four consecutive successes** across this work
   (`390e96a`, `dfda9cc`, `3328c53`, `4b692a3`), the last one over an
   **ordinary push**, not a deliberate empty-commit test, which is the
   more meaningful signal. Each reached `READY` with
   `source: "git"`, `target: "production"`, and Deployment Protection
   confirmed still active on every single one. ✅ Done.
3. **Member-role restriction check**: `wc-staging-member@example.com`'s
   password was reset (via the established secure procedure — admin
   API, never printed, saved to `.env.staging.local` only) since it
   wasn't recorded anywhere. Then tested at the real enforcement
   boundary (RLS/RPCs, not just UI) — 5 deny-side checks (recording a
   contribution, changing another member's role, reading
   `audit_logs`, reading other members' `contribution_records`,
   updating the group directly) and 2 allow-side checks (creating a
   governance proposal, reading own data). **7/7 pass.** Test proposal
   created during the check was deleted afterward. ✅ Done.
4. **Group-switching check**: no existing test account belonged to
   more than one group, so a throwaway temp-owner account created a
   second group and invited the existing test member into it with a
   **different role** (`treasurer`, vs. `member` in "Susu") to properly
   test per-group role scoping, not just multi-group membership. 7/7
   checks passed: exactly 2 active memberships with correct
   per-group roles; `record_contribution` correctly denied in Susu
   (role=member) and correctly allowed in the second group
   (role=treasurer) — proving **permissions follow the active group,
   not the account**; zero cross-group data bleed in either direction
   (contribution records and notifications both correctly scoped).
   **Cleaned up**: the temporary group (cascaded away its membership,
   contribution record, contribution plan, and notification) and the
   temp-owner account both deleted; member account verified back to
   exactly one active membership (Susu, role `member`) afterward. ✅
   Done.
5. **Vercel Toolbar spot-check**: `enablePreviewFeedback` and
   `enableProductionFeedback` both confirmed `false` — clean, no
   reversion this time. ✅ Done (but see recurring-check note below).

## Recurring check: Vercel Toolbar setting

`enableProductionFeedback` reverted from an explicit `false` back to
`null` (team-default) once already, unprompted, apparently as a side
effect of the Production Branch setting change earlier in this phase —
it caused the `vercel.live` CSP/console errors to reappear until
caught and fixed. **Re-check both `enablePreviewFeedback` and
`enableProductionFeedback` are still `false` after any future Vercel
project configuration change** — don't assume this setting is
permanently stable just because it's clean today.

## Open decision: `git-staging` alias

`wealth-circle-app-git-staging-royals-fashion-and-design-ltd.vercel.app`
currently points at a stale deployment (`wealth-circle-7ina66ilj-...`,
commit `1050389`) that predates all four recent push-to-deploy
verifications. Not changed — this is for the product owner to decide.

| Option | Pro | Con |
|---|---|---|
| Repoint manually now, and after every future push | Keeps the existing bookmarked URL stable | Pure manual toil forever, now that push-to-deploy actually works |
| Retire it, look up the current deployment URL as needed | No stale/misleading URL left sitting around | Loses a single memorable link |
| Replace it with `wealth-circle-app-seven.vercel.app` — the project's other domain, confirmed to already auto-update on every push with zero manual work (verified: it currently points at the exact deployment from step 2's ordinary push) | Already exists, already correct, zero setup needed | A different URL to (re-)bookmark than the familiar one |

**Recommended: replace** — `wealth-circle-app-seven.vercel.app` is
already doing, automatically, exactly what the old alias was manually
approximating.

## External blockers (unchanged, not addressed by any of the above)

1. **Production domain** — not yet selected or purchased.
2. **UK legal/regulatory counsel** — not yet engaged. Lending stays
   technically disabled for real users until a written opinion is
   obtained (see `legal-regulatory-review.md`).

Phase 10 implementation should not begin until both are resolved,
independent of how complete the technical checklist above is.
