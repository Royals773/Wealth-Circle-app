# Data Model

Source of truth, applied in order:
[`0001_init.sql`](../supabase/migrations/0001_init.sql) (schema + RLS),
[`0002_phase2_auth_functions.sql`](../supabase/migrations/0002_phase2_auth_functions.sql)
(group creation and invitation functions),
[`0003_fix_group_creation_visibility.sql`](../supabase/migrations/0003_fix_group_creation_visibility.sql)
and
[`0004_fix_accept_invitation_ambiguous_column.sql`](../supabase/migrations/0004_fix_accept_invitation_ambiguous_column.sql)
(two bugs found and fixed during live Phase 2 testing against a real
Supabase project — see
[security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing)).
TypeScript mirror: [`src/lib/types/database.ts`](../src/lib/types/database.ts).

## Conventions

- **Money** is `bigint` integer minor units (e.g. pence, cents), never
  floating point, always paired with a `char_length = 3` `currency_code`
  (ISO 4217).
- **Country codes** are ISO 3166-1 alpha-2 (`char_length = 2`).
- **Timestamps** are `timestamptz`, always UTC.
- **Tenant isolation**: every group-owned table has a `group_id` column
  referencing `groups(id)`, and Row Level Security policies scope every
  query to groups the current user belongs to. See
  [security-boundaries.md](./security-boundaries.md).
- **No silent deletes of financial records.** Corrections use a
  `reversal_of` self-reference plus a required `reversal_reason` — the
  original row is never removed.
- **Reconciliation accountability.** `contribution_records` and
  `repayments` both have a check constraint: a row cannot be `reconciled`
  without `reconciled_by` and `reconciled_at` set.

## Tables

| Table | Purpose |
|---|---|
| `profiles` | One row per Supabase Auth user. Display data only — never online-banking credentials. |
| `groups` | A private workspace: name, slug, country, currency, contribution settings, financial year, rules. |
| `group_memberships` | A user's role in one group (`owner`, `administrator`, `treasurer`, `loan_officer`, `auditor`, `member`) and status (`active`/`suspended`/`removed` — since Phase 7, `suspended`/`removed` are fully load-bearing: every RLS-gated table's access checks filter on `status = 'active'`, so a non-active status revokes both read and write access everywhere, not just this table). Unique per `(group_id, user_id)`. |
| `group_invitations` | Pending/accepted/revoked/expired invitations, addressed by email, carrying a role and an expiring token. Only a SHA-256 hash of the token is stored (`token_hash`) — the raw token is generated and returned exactly once, by `create_invitation()`, and is never persisted. |
| `ownership_transfers` *(Phase 7)* | A group's owner handing sole ownership to another active member — pending/accepted/declined/cancelled/expired, 7-day expiry (matching invitations). A unique partial index (`where status = 'pending'`) limits each group to one pending transfer at a time. |
| `contribution_plans` | A group's contribution scheme — fixed amount or flexible, frequency, effective dates. |
| `contribution_records` | Individual member contributions, with the full status lifecycle and optional link back to a `contribution_plan`. |
| `withdrawal_requests` | Requests to withdraw from the group's own bank account; supports two-approver sign-off (`approved_by_1/2`). |
| `loan_products` | A group's loan offering(s) — interest rate (basis points), limits. |
| `loan_applications` | Member applications against a loan product, with review outcome. |
| `loans` | Approved/disbursed loans, principal, term, status. |
| `repayments` | Repayments against a loan, with the same verify/reconcile lifecycle as contributions. |
| `approval_requests` / `approval_decisions` | Generic two-person-approval envelope usable by withdrawals, loan decisions, governance and financial corrections; one decision row per approver, enforced unique per `(approval_request_id, approver_id)`. |
| `governance_proposals` | Proposals a group votes on. |
| `votes` | One vote per `(proposal_id, voter_id)` — `for` / `against` / `abstain`. |
| `documents` | Metadata for files stored in Supabase Storage (`storage_path`) — no binary content in Postgres. |
| `notifications` | User-scoped (`recipient_id`); `group_id` nullable because some notifications (e.g. an invitation) precede group membership. |
| `audit_logs` | Append-only record of sensitive actions. No `UPDATE`/`DELETE` RLS policy exists for this table — rows cannot be altered or removed through the API. |

## Status lifecycles

Financial records generally move through a subset of:

`pending → submitted → verified → reconciled` (or `partly_paid → paid`),
with `overdue`, `rejected`, `cancelled` and `reversed` as terminal/exception
states. See [security-boundaries.md](./security-boundaries.md) for how
reconciliation and reversal are constrained at the database level, and
[permissions-matrix.md](./permissions-matrix.md) for who can move a record
between statuses.

## Automatic housekeeping

Two `SECURITY DEFINER` triggers keep the schema self-consistent without
giving the browser client elevated privileges:

- `on_auth_user_created` — inserts a `profiles` row whenever a new
  `auth.users` row is created, so every authenticated user always has a
  profile.
- `groups_after_insert_create_owner_membership` — inserts the creator's
  `owner` `group_memberships` row immediately after a `groups` insert. This
  exists because the `group_memberships` insert policy otherwise requires
  an *existing* manager membership, which cannot exist yet for a brand-new
  group.

## Phase 2 database functions

Added in `0002_phase2_auth_functions.sql`. All are called via
`supabase.rpc(...)` rather than raw table `.insert()`/`.update()` calls —
see [security-boundaries.md](./security-boundaries.md) for the security
reasoning behind each.

| Function | Security | Purpose |
|---|---|---|
| `create_group_with_setup` | invoker | Atomically creates a group, its owner membership, an optional initial contribution plan, optional initial invitations, and an audit log entry. |
| `create_invitation` | invoker | Manager-only. Generates a 256-bit random token, stores only its hash, returns the raw token once. |
| `revoke_invitation` | invoker | Manager-only, and only while the invitation is still `pending`. |
| `get_invitation_preview` | **definer** | Public, token-gated read (group name, role, invited email, status) so an unauthenticated visitor can see what they're being invited to before creating an account. |
| `accept_invitation` | **definer** | The only way a user can add themselves to a group. Validates the token, status, expiry, and that the caller's verified email matches the invitation, then inserts the membership with the role taken from the invitation itself. |

## Phase 7 database functions

Added in `0013_phase7_member_management.sql`, with an error-message-only
fix in `0014_fix_member_management_owner_lock_visibility.sql`. See
[security-boundaries.md](./security-boundaries.md#member-and-role-management-integrity-phase-7)
for the RLS gap this phase closed.

| Function | Security | Purpose |
|---|---|---|
| `active_owner_count` | invoker (stable helper) | Counts a group's active `owner` rows. Used identically inside RLS `WITH CHECK` and inside RPCs — never counted client-side. |
| `member_removal_blockers` | **definer** | Manager-or-self only. Returns a human-readable list of what's blocking a member's removal/departure (active loan, pending loan application, unverified repayment, pending/approved withdrawal, pending ownership transfer). Shared by `remove_member` and `leave_group`. |
| `change_member_role` | invoker | Manager-only, mandatory reason, rejects self-targeting and any owner-role involvement (assigning or changing away from `owner`). |
| `suspend_member` / `reactivate_member` | invoker | Manager-only; suspend rejects owner targets and mandatory reason; reactivate requires the target currently be suspended. |
| `remove_member` | invoker | Manager-only, mandatory reason, rejects owner targets and self-targeting, blocked by `member_removal_blockers`. |
| `leave_group` | invoker | Self-service. Blocked by `member_removal_blockers`, and by `active_owner_count` if the caller is the group's last active owner. |
| `initiate_ownership_transfer` | invoker | Owner-only. Target must be an active, non-owner member; one pending transfer per group (unique index). |
| `accept_ownership_transfer` | **definer** | Recipient-only. In one transaction: promotes the caller to `owner`, demotes the outgoing owner to `administrator`, marks the transfer accepted. Definer because ordinary RLS never allows self-promotion. |
| `decline_ownership_transfer` / `cancel_ownership_transfer` | invoker | Recipient declines their own pending transfer; any current owner of the group can cancel it. |

## Regenerating TypeScript types from a live project

Once a Supabase project is connected:

```bash
supabase gen types typescript --project-id <id> > src/lib/types/database.ts
```

The hand-written file was structured to match the shape the generator
produces (`Tables`/`Views`/`Functions`, each table's `Row`/`Insert`/`Update`/
`Relationships`), so no other file should need to change.
