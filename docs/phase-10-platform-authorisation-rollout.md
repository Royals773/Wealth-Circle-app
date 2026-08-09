# Platform-level group/organiser authorisation — staging rollout record

**Naming note:** this feature's migration and code comments call it
"Phase 10" (`0024_phase10_platform_authorisation.sql`), chosen
independently of this project's existing numbered-phase track.
[phase-10-plan.md](./phase-10-plan.md) and
[phase-10-planning.md](./phase-10-planning.md) are a **different,
pre-existing "Phase 10"** (production readiness, staging pipeline
verification, the lending legal-review gate) and were not touched or
renamed as part of this work, to avoid any drift between the
already-applied migration on disk and what's live on staging. Read
this document as "the platform-authorisation rollout," not as a
continuation of that other Phase 10.

## What this closes out

A read-only security audit (this session) found that any authenticated
user could create a group and immediately become its owner, and any
group owner/administrator could send invitations, with no
platform-level approval step, no way to suspend a group or an
organiser, and a directly-exploitable `groups.status` column (any
manager could `PATCH` it via the client). This work adds a full
platform-admin approval layer — organiser applications, group review,
suspend/reactivate, an invitation abuse-control layer, and an
active-group write gate across every financial/governance/membership
RPC — without weakening tenant isolation, existing read access, or
self-approval prevention.

## Migrations

- **`supabase/migrations/0024_phase10_platform_authorisation.sql`** —
  the full feature: `organiser_applications`/`platform_admins`/`platform_config`
  tables (zero or narrowly-scoped client policies), the extended
  `groups.status` lifecycle (`pending_review`/`active`/`rejected`/`suspended`/`archived`),
  13 new RPCs (organiser workflow, group moderation, `archive_group`,
  platform config), the `is_group_active()` gate added to ~35 existing
  mutation RPCs across memberships, ownership transfers, contributions,
  loans, repayments, withdrawals, and governance/votes, invitation
  abuse controls (rate limit, cap, duplicate-email, advisory-lock
  concurrency), and a NOT EXISTS-guarded organiser-grandfathering
  backfill. Applied to staging in 14 dependency-ordered chunks, each
  independently verified against the live catalog (function
  signatures, security mode, ACLs, policies, indexes) — not against
  bare "Success" messages.
- **`supabase/migrations/0025_fix_leave_group_audit_log_rls.sql`** — a
  separate, small fix for a real bug found live while testing this
  feature: `leave_group()` (Phase 7, `0013_phase7_member_management.sql`,
  unrelated to this feature's own logic) wrote its audit log entry
  *after* updating the caller's own membership to `'removed'`, which
  made the RLS check on that insert (`is_group_member`, requiring
  `status = 'active'`) fail against the row's own just-changed state —
  so `leave_group()` had never successfully completed for any group,
  active or otherwise. Fixed by reordering the two statements. Verified
  live.

## Two real bugs found and fixed during live verification

1. **`is_platform_admin()` anon-execute gap (genuine Phase 10
   regression).** The function's `EXECUTE` grant was `authenticated`-only,
   but it's referenced inside three RLS policies
   (`groups_select_platform_admins`, `organiser_applications_select_platform_admins`,
   `audit_logs_select_platform_admins`). RLS evaluates every applicable
   policy for the querying role, including `anon` — so any anonymous
   `SELECT` against `groups` (a normal, expected pre-auth path) hit
   `permission denied for function is_platform_admin` and the whole
   query errored instead of returning an empty result. Fixed by
   granting `anon` execute on that one function (safe: for `anon`,
   `auth.uid()` is null, so it always evaluates to `false` — no
   information leak). Confirmed via `tenant-isolation.test.ts`'s
   "does not let anonymous users read any group data" test: failing
   before the fix, 13/13 passing after.
2. **`leave_group()` audit-log RLS bug** — see `0025` above. Pre-existing,
   unrelated to this feature's own logic, found only because this was
   the first live test to ever exercise a full successful `leave_group()`
   call.

## Supabase default-privileges gotcha (worth remembering)

`revoke all on function ... from public` does **not** revoke a grant a
role holds directly via `ALTER DEFAULT PRIVILEGES` (confirmed live:
this project's Supabase setup auto-grants `EXECUTE` on every new
`public`-schema function to `anon`/`authenticated`/`service_role`
directly, not via the `PUBLIC` pseudo-role). Every `SECURITY DEFINER`
function in `0024` that should be `authenticated`-only explicitly
revokes from `public, anon` (not just `public`) for this reason.

## Application layer

- New: `/apply-organiser`, `/platform-admin` (independently gated —
  page loader, every Server Action, and every RPC each separately
  check `is_platform_admin()`; the page being absent from nav is not a
  security boundary), `src/lib/actions/organiser.ts`,
  `src/lib/actions/platform-admin.ts`, `src/lib/data/organiser.ts`,
  `src/lib/data/platform-admin.ts`, `src/components/platform-admin/*`.
- Updated: onboarding messaging (new groups start `pending_review`, no
  longer send invitations at creation time), the dashboard shell
  (suspended/pending/rejected/archived banner), the invitation
  acceptance page (consumes `get_invitation_preview`'s new
  `can_accept`/`message` shape instead of raw status), `src/lib/types/database.ts`.

## Test coverage

- **New:** `tests/security/platform-authorisation.test.ts` — 31/31
  live, covering self-approval prevention, co-owner self-approval
  prevention, the full group/organiser state machines, the suspended-group
  write gate across every RPC category, invitation abuse controls
  under real concurrency, invitation-preview privacy, and direct-client
  write rejection on `groups`/`platform_admins`.
- **Fixed:** all 12 pre-existing live security test files needed two
  fixture updates apiece (grant the test group-creator an approved
  organiser application before calling `create_group_with_setup`;
  activate the resulting group, since it now starts `pending_review`) —
  27 call sites across `audit.test.ts`, `backdated-contributions.test.ts`,
  `constitution.test.ts`, `contributions.test.ts`, `governance.test.ts`,
  `loan-eligibility-calendar.test.ts`, `loans.test.ts`, `membership.test.ts`,
  `notifications.test.ts`, `reports.test.ts`, `tenant-isolation.test.ts`,
  `withdrawals.test.ts`.
- **`loan-eligibility-calendar.test.ts`** updated (not by this feature
  — pre-existing staleness against `0021`'s lending legal gate,
  surfaced by finally re-running the full live suite): its
  `apply_for_loan()` eligibility-math tests now assert the
  `0021` permission-denied block, with a comment noting the underlying
  eligibility math needs re-verification once that gate lifts.
- **`loans.test.ts`** skipped wholesale (`describe.skip`, documented
  inline) for the same reason, at much larger scale — nearly the
  entire file depends on a working loan lifecycle
  (apply → decide → disburse → repay → verify → reconcile → reverse),
  every step of which `0021` blocks. Not part of this feature; needs
  restructuring once lending is un-gated.
- **Known, pre-existing, unrelated flake:** `notifications.test.ts`'s
  scheduler batch-claim count (Phase 9 territory) failed once under
  concurrent-file load, passed cleanly in isolation (19/19) both
  before and after. Not touched.

## Verification discipline

Every migration chunk was verified against the live Postgres catalog
(`pg_proc`, `pg_policies`, `pg_indexes`, `pg_constraint`) after
application — function signatures, security mode (`prosecdef`), grant
lists (`proacl`), and policy `USING` clauses — never a bare "Success"
message. At closeout, both `0024` and `0025` were re-confirmed to
match disk exactly via direct `prosrc` comparison for a representative
high-risk sample (`is_platform_admin`, `create_invitation`,
`get_invitation_preview`, `decide_group_review`, `leave_group`,
`cast_vote`).

## Platform-admin bootstrap

Completed and verified per [platform-admin-bootstrap.md](./platform-admin-bootstrap.md).
Exactly one account holds the role on staging, confirmed via direct
`platform_admins` table read (single row) — no UUID is hard-coded in
any migration; the grant is a manual, out-of-band service-role insert,
matching the project's existing `scheduler_capabilities` bootstrap
precedent.

## Known limitations and deferred items

- **Auth rate limiting under parallel test execution**: running all 13
  live security test files via `npm run test:security`'s default
  parallel file execution collectively exceeds Supabase's Auth API
  rate limit for this staging project, causing intermittent (different
  files each run) sign-in failures. Every file passes cleanly when run
  in isolation — this is environmental (test infrastructure /
  Supabase plan limits), not a functional defect. Not changed as part
  of this work; worth considering `--no-file-parallelism` or a higher
  rate-limit tier if this becomes a recurring friction point.
- **`loans.test.ts` needs restructuring**, and
  **`loan-eligibility-calendar.test.ts`'s eligibility-math assertions
  need re-verification**, once `0021`'s lending legal-review gate is
  lifted. Neither is blocking for this feature; both are pre-existing
  gaps this rollout's live-testing surfaced rather than caused.
- **167 leftover `@example.com` test accounts** exist in the staging
  project's `auth.users`, accumulated across this session's repeated
  live-test runs (some likely orphaned by interrupted runs whose
  `afterAll` cleanup never ran). Not cleaned up as part of this
  closeout, per explicit instruction to leave staging fixtures alone;
  flagged for a future housekeeping pass.
- **The `archived`/`closed` naming question, the rejected-group terminal
  state, and the `expire_stale_*` exemptions** were all explicitly
  confirmed with the project owner before implementation (see the
  design-review conversation this migration is based on) — not open
  questions, recorded here only so the rationale is discoverable
  without needing the original chat history.
