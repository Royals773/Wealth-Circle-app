# Database Backup and Recovery (Phase 9)

WealthCircle's only durable state lives in its Supabase Postgres
project — there is no other datastore to back up. This is a
configuration and process document, not code: backups themselves are a
Supabase project setting, not something this codebase can enable.

## What Supabase offers

Supabase's backup capability depends on the project's plan tier:

- **Free tier**: no automatic backups. The project can be manually
  exported (`pg_dump`-equivalent via the dashboard or CLI) but nothing
  runs on a schedule.
- **Pro tier and above**: daily automatic backups with a retention
  window (typically 7 days on Pro, longer on higher tiers), restorable
  via the Supabase dashboard.
- **Point-In-Time Recovery (PITR)**: a paid add-on on top of Pro+,
  giving continuous WAL-based recovery to any point within the
  retention window (not just once-a-day snapshots) — the appropriate
  choice once real financial data exists, since a day of lost
  contribution/loan/withdrawal activity is not an acceptable gap for
  this kind of application.

**Decision needed (cost-driven, the user's call, not made here):** which
tier and retention window to pay for before real users are onboarded.
Given the app's nature (group savings and lending — every row is
someone's money), PITR is the recommended minimum once launch is real,
not merely daily snapshots; the exact retention window (7/14/30 days)
is a cost/risk trade-off to set deliberately, not a default to accept
silently.

## Manual recovery drill (do this before relying on backups)

A backup that has never been restored is unverified. Before launch,
run this drill once, and again after any major schema change:

1. Note a "known-good checkpoint": pick a specific point in time and
   record simple, verifiable facts about the database at that moment —
   total row counts for `groups`, `group_memberships`,
   `contribution_records`, `loans`, `withdrawal_requests` is enough;
   this doesn't need to be exhaustive, just enough to detect "the
   restore obviously lost data."
2. Trigger a restore to a **fresh, separate Supabase project** — never
   restore over the live project as the first attempt at this drill.
3. Confirm the restored project's row counts match the checkpoint from
   step 1, and spot-check a handful of RLS policies and RPC functions
   still work as expected (e.g. `create_group_with_setup`,
   `accept_invitation`) — a restore that recovers rows but not schema
   objects (functions, policies, indexes) is incomplete.
4. Record how long the whole drill took — this is the real-world
   Recovery Time Objective (RTO) until proven otherwise by an actual
   incident, and should inform whether the chosen tier's restore
   process is fast enough for this application's needs.
5. Delete the fresh project once the drill is confirmed, so it doesn't
   linger as an unmanaged, un-monitored copy of user data.

## Rollback strategy for schema changes

Every migration in `supabase/migrations/` to date has been forward-only
— there is no `down.sql` mechanism anywhere in this project's history.
When a migration needed correcting (e.g. `0016` fixing a regression
`0015` introduced), the fix was a new forward migration, not a revert.
This is the established, demonstrated pattern and should stay the
pattern: if a Phase 9+ migration ever needs undoing in production, write
a new corrective migration rather than attempting to hand-roll a
rollback script for the first time under incident pressure.

## What this document does not cover

- Application-level "soft delete"/undo for user actions (e.g.
  reversing a contribution) — already handled per-feature via the
  existing reversal RPCs (`reverse_contribution`,
  `reverse_withdrawal_payment`, etc.), not a backup/recovery concern.
- Disaster recovery for anything outside Supabase (email provider,
  hosting platform) — those are covered by their own vendors' SLAs once
  chosen (see `docs/phase-9-deployment-checklist.md`).
