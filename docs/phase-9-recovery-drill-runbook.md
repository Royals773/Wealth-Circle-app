# Recovery Drill Runbook (Phase 9)

A concrete, copy-pasteable execution of the manual recovery drill described
in [phase-9-backup-recovery.md](./phase-9-backup-recovery.md). That
document explains *why* this drill matters and the general shape of it;
this one is the exact checklist to run it for real, once a backup actually
exists on staging (confirmed **not yet true** as of this writing — see
"Precondition" below).

**Status: prepared, not run.** Nothing in this document has been executed.
Do not run any step until the precondition is met and you've reviewed the
open verification item in Step 2.

## Precondition — a backup must exist first

Checked via `supabase backups list --project-ref zxxkmvoovdlxpikkvqvs`
(2026-09-13): `pitr_enabled: false`, `backups: []` — **zero backups
currently exist for staging.** This drill cannot be executed until that
changes (a tier/PITR decision, per `phase-9-backup-recovery.md`'s own
"decision needed" section, resolved separately from this runbook). Re-run
that same command before attempting Step 3 below — don't assume backups
exist just because time has passed.

## Step 1 — Checkpoint (captured 2026-09-13, read-only)

Captured via direct SQL against staging (ref `zxxkmvoovdlxpikkvqvs`), read-only,
nothing else touched:

```sql
select 'groups' as table_name, count(*) as row_count from public.groups
union all select 'group_memberships', count(*) from public.group_memberships
union all select 'contribution_records', count(*) from public.contribution_records
union all select 'loans', count(*) from public.loans
union all select 'withdrawal_requests', count(*) from public.withdrawal_requests
union all select 'profiles', count(*) from public.profiles
union all select 'auth.users', count(*) from auth.users
union all select 'organiser_applications', count(*) from public.organiser_applications
union all select 'audit_logs', count(*) from public.audit_logs
order by table_name;
```

**Baseline row counts, 2026-09-13:**

| Table | Row count |
|---|---|
| `groups` | 1 |
| `group_memberships` | 1 |
| `contribution_records` | 0 |
| `loans` | 0 |
| `withdrawal_requests` | 0 |
| `profiles` | 2 |
| `auth.users` | 2 |
| `organiser_applications` | 1 |
| `audit_logs` | 3 |

The first five rows are exactly the tables `phase-9-backup-recovery.md`
names. `profiles`, `auth.users`, `organiser_applications`, and `audit_logs`
are added here as a slightly wider sanity net — still "not exhaustive,"
per that doc's own framing, just enough surface area to catch an obviously
incomplete restore.

**This baseline goes stale as staging's data changes.** Before actually
running Step 3, re-run the query above and use *that* fresh count as your
real comparison point — don't compare a live restore against this
now-historical snapshot without re-checking it's still current.

## Step 2 — Spot-check list

RLS policies and RPCs to verify still work correctly against the restored
database, beyond raw row counts (a restore that recovers rows but not
schema objects — functions, policies, indexes — is incomplete, per
`phase-9-backup-recovery.md`):

| # | What to check | How |
|---|---|---|
| 1 | `create_group_with_setup` RPC | As a confirmed, organiser-approved test user, call it with a throwaway name/slug. Confirm it returns a `group_id` and the row appears in `groups` with `status = 'pending_review'`. |
| 2 | `accept_invitation` RPC | Create an invitation via `create_invitation`, then accept it as the invited (different) user. Confirm a `group_memberships` row is created with the correct role. |
| 3 | `decide_organiser_application` RPC + platform-admin gate | As a non-admin, confirm the RPC is rejected. As a bootstrapped platform admin, confirm it succeeds and updates `organiser_applications.status`. |
| 4 | Tenant isolation (RLS) | As a member of Group A, attempt to read a Group B row directly (e.g. `select * from group_memberships where group_id = '<group B id>'`). Confirm zero rows return — not an error, a real empty result under RLS. |
| 5 | Lending gate | Confirm all 11 lending RPCs (`apply_for_loan` etc.) still show `EXECUTE: false` for `anon`/`authenticated` — same query pattern used throughout this project's earlier live diagnosis: `select has_function_privilege('authenticated', '<fn>'::regproc, 'EXECUTE')`. A restore from before migration `0021` was applied would silently re-open lending — this is the single highest-stakes thing this drill could catch. |

**Open verification item, not yet confirmed**: `phase-9-backup-recovery.md`
says to restore into "a fresh, separate Supabase project... never restore
over the live project as the first attempt." The CLI command
`supabase backups restore --project-ref <ref> --timestamp <t>` is an
**in-place PITR restore on the given project** per its own `--help` output
— it does not create or target a separate project. Achieving a genuinely
separate restore target will most likely mean using the Supabase
**Dashboard's** Backups UI (Database → Backups), which may offer a
"restore to a new project" option depending on the plan — this needs to be
confirmed directly in the dashboard at drill-time, not assumed from the
CLI alone. If no such dashboard option exists on whatever plan is active,
that's itself a finding worth recording before proceeding, since it
changes the risk profile of running this drill at all.

## Step 3 — Execute (not yet run)

1. Confirm the precondition again: `supabase backups list --project-ref zxxkmvoovdlxpikkvqvs` — must show at least one entry in `backups`.
2. Re-run the Step 1 checkpoint query and record fresh counts before proceeding — do not reuse the 2026-09-13 numbers above without re-verifying them.
3. In the Supabase Dashboard, confirm the restore-target mechanism (new project vs. in-place) per the open item in Step 2, and choose accordingly. If only in-place restore is available, stop and get explicit sign-off before proceeding — restoring staging in place means accepting the loss of everything created after the restore point, on the live project.
4. Trigger the restore (dashboard, or `supabase backups restore --project-ref <target-ref> --timestamp <t>` if targeting a genuinely separate new project).
5. Re-run the Step 1 checkpoint query against the restored database. Compare every row against the fresh counts from step 2 of this section.
6. Run every check in the Step 2 spot-check table against the restored database.
7. Record the timing below.
8. If the restore target was a separate new project: delete it once the drill is confirmed complete, so it doesn't linger as an unmanaged, un-monitored copy of data.

## Timing record (fill in when actually run)

| Field | Value |
|---|---|
| Drill date | |
| Backup/restore point used | |
| Restore triggered at | |
| Restore completed at | |
| Total time (RTO) | |
| Step 1 checkpoint match? | |
| Step 2 spot-checks all passed? | |
| Fresh project deleted afterward (if applicable)? | |
| Notes / anomalies | |
