# Data Model

Source of truth: [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql).
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
| `group_memberships` | A user's role in one group (`owner`, `administrator`, `treasurer`, `loan_officer`, `auditor`, `member`) and status. Unique per `(group_id, user_id)`. |
| `group_invitations` | Pending/accepted/revoked/expired invitations, addressed by email, carrying a role and an expiring token. |
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

## Regenerating TypeScript types from a live project

Once a Supabase project is connected:

```bash
supabase gen types typescript --project-id <id> > src/lib/types/database.ts
```

The hand-written file was structured to match the shape the generator
produces (`Tables`/`Views`/`Functions`, each table's `Row`/`Insert`/`Update`/
`Relationships`), so no other file should need to change.
