# Relaunch Runbook — staged, ready to fire

**Status: prepared, not executed.** This document exists so that once
the two real blockers below are cleared, going live is a short,
confirmable sequence of already-tested steps — not another evening of
discovery. Nothing in this file has been run. Do not run any step
until every item in "Preconditions" is checked off for real, not
assumed.

Written after a public-launch attempt on 2026-08-06 that reached
production exposure (`wealth-circle-app-seven.vercel.app` served the
live app to unauthenticated visitors) before the lending review and
incorporation blockers were resolved. No harm occurred — verified
directly against the database: zero accounts created during the
exposure window, zero loan records ever — but the sequence outran its
own safety checks. This runbook is the fix: the technical steps proven
correct that night, gated explicitly on the two things that actually
still need to happen.

This historical record — including the 2026-08-06 exposure above and
the product owner's prior decision (recorded in
[legal-regulatory-review.md](./legal-regulatory-review.md#launch-gate))
to proceed with a full public launch, lending included, without a
written legal opinion on file — is preserved here unedited. Nothing in
this document, including the pilot-scope note below, revises or
removes that record.

## Scope: this runbook governs commercial/public relaunch only

This entire document — every precondition, every step, every rollback
procedure below — describes the **commercial or public relaunch** of
WealthCircle: a production deployment (`main`, `wealth-circle-app-seven.vercel.app`
or a chosen production domain, Deployment Protection removed) that the
general public, or paying/registered customers, can reach. **None of
it applies to, is satisfied by, or is a step toward, the separate
controlled non-commercial pilot** described in
[non-commercial-pilot-charter.md](./non-commercial-pilot-charter.md).

The pilot:

- Runs on `staging`, invitation-only, never on `main` or a public
  production domain.
- Does not go through Steps 1–7 below. Nothing in the pilot removes
  Deployment Protection for public reach, points a public domain at a
  deployment, or merges to `main`.
- Does not, by itself, satisfy any box in "Preconditions" below. A
  successful pilot is evidence the product owner can use when later
  deciding whether to pursue commercial launch — it is not a
  substitute for the legal opinion, incorporation, or any other
  precondition.
- Keeps lending technically disabled throughout, via the same gate
  (`supabase/migrations/0021_gate_lending_pending_legal_review.sql`
  and the `LENDING_DISABLED` application flag) referenced in Step 2
  below. Nothing about running the pilot enables lending; only a
  **separate, explicit, written instruction** from the product owner,
  following the process in Step 2, can do that — and Step 2 remains
  gated on the legal opinion regardless of pilot outcome.

**On the legal/regulatory precondition specifically**: for the purpose
of opening the pilot, the product owner has instructed that
legal/regulatory issues relevant to running a controlled,
invitation-only, non-commercial, non-lending pilot are addressed. That
instruction is recorded here as the product owner's own instruction —
it is not a claim, made by this document or anyone maintaining it,
that a written legal opinion on the lending question has been obtained
or that
[legal-regulatory-review.md](./legal-regulatory-review.md) has changed
status. That file's own recorded status governs the actual
Preconditions checkbox below, unedited by this note. No solicitor,
opinion date, or regulatory conclusion is asserted anywhere in this
document beyond what that file already records.

**On incorporation**: incorporation remains deliberately deferred for
the pilot (see the charter) and is unaffected by this note.
WealthCircle is not incorporated. This document does not claim
otherwise, and the pilot does not authorise commercial operation.

## Preconditions — every box must be checked before Step 1

- [ ] **UK legal/regulatory opinion obtained and recorded** in
      `docs/legal-regulatory-review.md`. See
      `docs/counsel-engagement-email-draft.md` — send it, then update
      that file with the outcome once counsel replies.
- [ ] **Decision made on the back of that opinion**: either (a)
      lending is cleared as-built and Step 2 below re-enables it, or
      (b) lending stays disabled/restricted (interest capped, group
      size capped, geofenced, etc.) and Step 2 is skipped or adjusted
      accordingly — **do not default to "just re-enable it," read the
      opinion first.**
- [ ] **Company incorporated**, with a real registered address. See
      `docs/incorporation-checklist.md`.
- [ ] **Vercel Production Branch set to `main`**, confirmed via the
      API (`link.productionBranch` on the project), not assumed from
      the dashboard alone.
- [ ] Production domain decided (if not launching on
      `wealth-circle-app-seven.vercel.app`/similar) — DNS, SSL, and
      `NEXT_PUBLIC_APP_URL` all need to agree before Step 5.

## Step 1 — Update legal pages with the real registered address

`src/lib/legal-content.ts`'s Terms (`18. Contact`) and Privacy
(`14. Contact details`) sections currently omit a physical address by
design (`Do not publish a physical address`, per the 2026-08-06
session). Once incorporated:

- Add the registered address to both sections, in the same list
  format the placeholder lines used before they were removed.
- Re-run `npx tsc --noEmit && npx eslint . && npm run build && npx vitest run`.
- Commit, on `staging` first (matching this project's established
  flow), then merge to `main`.

## Step 2 — Re-enable lending (only if counsel's opinion clears it)

Reverses `supabase/migrations/0021_gate_lending_pending_legal_review.sql`
exactly, function by function. Apply via the SQL Editor, same
plain-text-only discipline as every migration this session (never
through a `cat`/`echo` shell wrapper):

```sql
grant execute on function public.apply_for_loan(uuid, bigint, integer, text) to authenticated;
grant execute on function public.mark_loan_under_review(uuid) to authenticated;
grant execute on function public.decide_loan_application(uuid, text, bigint, integer, integer, text, text) to authenticated;
grant execute on function public.cancel_loan_application(uuid) to authenticated;
grant execute on function public.record_disbursement(uuid, date, text, text) to authenticated;
grant execute on function public.mark_loan_defaulted(uuid, text) to authenticated;
grant execute on function public.record_repayment(uuid, bigint, date, text, text, text) to authenticated;
grant execute on function public.verify_repayment(uuid) to authenticated;
grant execute on function public.reconcile_repayment(uuid) to authenticated;
grant execute on function public.reject_repayment(uuid, text) to authenticated;
grant execute on function public.reverse_repayment(uuid, text, jsonb) to authenticated;
```

After running it, verify the opposite of the 2026-08-06 check: call
each function as a real authenticated test user and confirm it now
executes the function's own logic (fails on invalid test data with a
business-logic error, not `42501 permission denied`) — same
independent-verification discipline as every other step this session.
Record the date and the opinion this decision rests on in
`docs/legal-regulatory-review.md`.

If counsel's opinion requires product changes (interest disabled,
group size capped, disclosures added, jurisdictions excluded) instead
of a plain re-enable, implement those first and treat this step as
"gate lifted with conditions," not a blanket re-grant.

## Step 3 — Full verification gate

```
npx tsc --noEmit
npx eslint .
npm run build
npx vitest run
```
All four must be green. If `tests/security/*` have drifted from the
live database state (new migrations since the last live run), also
run `npm run test:security` against the target project before
proceeding.

## Step 4 — Merge and deploy to production

1. `git checkout main && git merge staging` — confirm clean, no
   conflicts (same as 2026-08-06's Step 2).
2. `git push origin staging && git push origin main`.
3. Confirm the resulting deployment via the Vercel API (not just the
   CLI summary): `source: "git"`, `target: "production"`,
   `githubCommitRef: "main"`, `githubCommitSha` matching `main`'s
   HEAD, `readyState: "READY"`. This only works correctly now that the
   Production Branch precondition above is actually fixed — pushing
   `main` before that fix produces a Preview deployment, not
   Production (the exact mistake that led to the `vercel promote`
   workaround on 2026-08-06).

## Step 5 — Point the domain

Confirm the custom domain (if any, beyond the `.vercel.app` alias) is
attached to the Production environment and resolves over HTTPS.
Report status before proceeding — this step is inert with respect to
public exposure (DNS pointing at a still-protected deployment reveals
nothing) as long as Step 6 hasn't happened yet.

## Step 6 — Remove Deployment Protection (the actual public-exposure step)

**This is the step that makes the app reachable. Everything before
this point is safe to complete even slowly, even the night before.**

Given this Vercel plan does not support SSO/Vercel Authentication or
Advanced (password) Deployment Protection on production/custom-domain
deployments (confirmed directly on 2026-08-06 — both returned plan
-ineligibility errors), "removing protection" in practice means:
re-adding the intended public alias via
`vercel alias set <deployment-url> <public-domain>` (it was removed
entirely on 2026-08-06, not just re-gated) and confirming the public
domain returns `200`, not `302` to `vercel.com/sso-api` and not `404`.

Do this **only** immediately before Step 7, not the night before — the
gap between "reachable" and "verified working" should be minutes, not
hours.

## Step 7 — Live verification, as a real unauthenticated visitor

- [ ] Load the public domain — confirm it's the app, not a stale/wrong
      deployment.
- [ ] Load all four legal pages (Terms, Privacy, Cookies, Acceptable
      Use) — confirm the finalized lawful-basis/retention/contact text
      from 2026-08-06 and the real registered address from Step 1
      above both render correctly.
- [ ] Walk the open registration flow end to end: create account,
      member profile form, consent checkbox links resolve to the live
      policy pages (not 404, not localhost).
- [ ] Clean up the real test account created during this walkthrough
      (delete it — this one genuinely will be a real signup in the
      real production project, unlike every disposable test account
      used throughout development).
- [ ] Confirm lending is in the correct state for launch (disabled per
      Step 2 being skipped, or enabled per Step 2 having run) — do not
      leave this ambiguous.

## Rollback, if anything in Step 7 fails

Re-run `vercel alias remove <public-domain>` immediately (the
2026-08-06 fix, proven to work — confirmed `404` within seconds) rather
than trying to debug live. Investigate against staging, not
production, then repeat from Step 4.
