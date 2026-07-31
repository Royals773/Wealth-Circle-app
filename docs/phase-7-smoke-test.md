# Phase 7 Manual Smoke Test

A manual, click-through verification of Phase 7 (member and role
management), run the same way the Phase 2-6 smoke tests were — see
[phase-6-smoke-test.md](./phase-6-smoke-test.md) for that precedent.
Automated coverage ran and passed first; this record covers what a real
person clicking through a real browser confirmed on top of that,
including one real bug the automated suites caught first and this
walkthrough then verified end-to-end.

## Automated results

- `npx tsc --noEmit` — pass
- `npm run build` — pass
- `npx eslint .` — pass
- `npx vitest run` — 123/123 unit tests pass (no new pure-logic unit
  tests this phase — Phase 7's logic is inherently server-side/RLS, the
  same conclusion Phase 6 reached before writing `withdrawals.test.ts`/
  `governance.test.ts`)
- `npm run test:security` — 102/102 live tests pass (86 pre-existing + 16
  new: `tests/security/membership.test.ts`) — against the real Supabase
  project after `0013_phase7_member_management.sql` and
  `0014_fix_member_management_owner_lock_visibility.sql` were applied.
  One pre-existing test (`tenant-isolation.test.ts`'s self-promotion
  check) needed updating for the new RLS shape — see "Bug found" below.

## Manual walkthrough

Used four throwaway, clearly-labelled test accounts
(`wc-p7-owner@example.com`, `wc-p7-admin@example.com`,
`wc-p7-member@example.com`, `wc-p7-second@example.com`) in "Phase 7
Walkthrough Group". All four accounts and the group were deleted via a
targeted script immediately after. No real financial information was
used.

| Step | Result |
|---|---|
| Members page shows all 4 active members, correct roles, "(you)" tag, "Use Leave group" instead of an actions menu on the signed-in user's own row | ✅ Confirmed |
| Change a member's role (member → treasurer) with a mandatory reason | ✅ Confirmed |
| Suspend a member | ✅ Confirmed |
| Suspended member immediately loses read access to the group (initially reported as still visible — traced to a stale/reused browser session, not a bug; confirmed correct on a genuinely fresh sign-in) | ✅ Confirmed after re-test |
| Reactivate a suspended member | ✅ Confirmed |
| Owner initiates an ownership transfer (first attempt failed correctly with "Only the group owner can initiate..." — traced to testing from the wrong browser session, not a bug; succeeded from the correct owner session) | ✅ Confirmed |
| Recipient (administrator) sees the pending transfer and accepts it | ✅ Confirmed |
| Roles swap correctly: recipient becomes owner, original owner becomes administrator | ✅ Confirmed |
| New sole owner attempts to leave the group → blocked with an explanation | ✅ Confirmed |
| Remove a member with no outstanding obligations → appears under the Removed tab | ✅ Confirmed |
| Mobile viewport (~375px): Members page switches to stacked cards, tabs/search remain usable, row actions menu still works on a card | ✅ Confirmed |

## Bug found and fixed during this session

### Owner-target actions raised the wrong error message

`change_member_role()`, `suspend_member()`, and `remove_member()` each
looked up the target row with `select ... for update` before deciding
what to do. Under Postgres RLS, `SELECT ... FOR UPDATE` must satisfy not
only the `SELECT` policy but also the `USING` clause of any applicable
`UPDATE` policy — and the only `UPDATE` policy covering these rows
(`group_memberships_manage_non_owners`) deliberately excludes `role =
'owner'`, since owner rows are meant to be untouchable by these RPCs.
So locking a target row that currently held `owner` silently returned
no row, and the code fell through to a generic "Member not found in
this group" instead of the intended "...owner cannot be
suspended/removed..." / "...ownership transfer workflow..." message.

Found by the new live security test ("prevents an administrator from
changing, suspending, or removing the group owner"), not the manual
walkthrough — caught before the guided session even started. The action
was still correctly blocked either way (RLS did its job); this only
fixed which error message the caller sees. Fixed in
**`supabase/migrations/0014_fix_member_management_owner_lock_visibility.sql`**
— idempotent (`create or replace function` only, no schema or data
changes) — by dropping `for update` from those three lookups. Row
locking isn't load-bearing there: the later `update ... where group_id
= ... and user_id = ...` statement still serializes concurrent writes to
the same row on its own, so no real concurrency guarantee was lost.

This same RLS interaction also changed the expected result of a
pre-existing test: `tenant-isolation.test.ts`'s "does not let a user
change their own membership row (self-promotion)" test previously
expected a silent zero-row update, because under the old Phase 1 policy
a user's own row was never visible to an update attempt at all. Since
Phase 7 added `group_memberships_leave_own` (which *does* make a user's
own active row visible to `UPDATE ... FOR ...`, specifically so someone
can leave a group), the same self-promotion attempt now correctly
errors instead of silently matching zero rows — still blocked, just via
a different (and, for this case, clearer) RLS mechanism. Updated the
test's assertion and comment to match; no application code change was
needed for this part.

## Cleanup

All four test accounts and the demo group were deleted via a targeted,
non-bulk script immediately after this walkthrough, per the same policy
established in Phase 5.

## Before Phase 8

1. **UK legal and regulatory review of the group lending model and all
   customer-facing loan/interest wording** — still not done, unchanged
   from Phase 4, still required before any real group uses the loans
   feature.
2. Continue using Mailtrap for development email only — swap for a
   production provider before real users, per
   [phase-2-smoke-test.md](./phase-2-smoke-test.md#before-phase-3--and-before-real-users).
3. Co-owners remain structurally possible in the schema (nothing
   prevents a second `group_memberships` row with `role = 'owner'` in
   the same group) but were never a designed feature in this phase —
   Phase 7 protects the *count* of active owners via
   `active_owner_count()`, not a specific person. If simultaneous
   co-ownership is ever wanted as a real feature, it needs its own
   explicit design pass (e.g. what "the sole owner cannot leave" should
   mean when there are two).
4. Ownership transfers and membership changes are visible only in-app
   (Members page, Ownership card) — no email notification is sent when
   one is initiated, accepted, declined, or cancelled. Acceptable for
   this phase's boundary, but worth revisiting once Phase 8's
   notification system exists.
