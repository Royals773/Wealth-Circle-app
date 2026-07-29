# Security Boundaries

## The financial boundary, restated

WealthCircle is software-only. It never holds, receives, transfers,
distributes, or initiates movement of members' money, and never presents
itself as a bank, credit union, or investment provider. This is a product
decision enforced throughout the architecture, not just marketing copy —
there is no code path anywhere in this codebase that moves money. See
[product-brief.md](./product-brief.md) for the full statement and
[mvp-roadmap.md](./mvp-roadmap.md) for what stays explicitly out of scope
in every future phase (Open Banking, card issuance, automated transfers,
etc.).

## Row Level Security is the enforcement point

`src/lib/permissions.ts` (capability-by-role) exists to drive **UI**
decisions — which buttons and links to show. It is convenience logic, not
security. **The only real security boundary is Postgres Row Level
Security**, defined in
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql).
Every table that holds group-owned data has RLS enabled and policies that
scope access to active members of that `group_id` — a user can never read
or write a row belonging to a group they don't belong to, regardless of
what the UI does or doesn't render.

Two helper functions make this tractable and avoid recursive-policy
problems:

- `is_group_member(group_id)` — is the current `auth.uid()` an active
  member of this group?
- `has_group_role(group_id, roles[])` / `is_group_manager(group_id)` —
  does the current user hold one of the given roles (owner/administrator
  shorthand) in this group?

Both are `SECURITY DEFINER` with a fixed `search_path`, which is what lets
them be used inside the `group_memberships` table's own policies without
the policy recursively re-evaluating itself.

## Tenant isolation

Every group-owned table carries `group_id`, and every `SELECT`/`INSERT`/
`UPDATE` policy on it calls `is_group_member` or a role-scoped variant.
There is no cross-group query path available to the anon/authenticated
Postgres roles the browser and server clients use — the browser client
only ever holds the public anon key (see below), so even a compromised
client cannot read another group's data.

## Two-person approval

- `withdrawal_requests` has `approved_by_1`/`approved_at_1` and
  `approved_by_2`/`approved_at_2` columns, plus a check constraint that the
  two approvers must be different people
  (`withdrawal_dual_approval_distinct`).
- The generic `approval_requests` / `approval_decisions` pair extends the
  same pattern to other sensitive actions (loan write-offs, governance
  decisions, financial corrections): one `approval_decisions` row per
  approver, unique per `(approval_request_id, approver_id)`, so the same
  person cannot register two decisions on one request.
- `src/lib/permissions.ts` exposes `canApproveOwnRequest()`, which always
  returns `false` — documented as a reminder that self-approval must never
  be allowed at any layer that consumes this module.

## Auditability

- `audit_logs` is append-only: RLS defines `SELECT` (for owners,
  administrators and auditors) and `INSERT` policies, but **no `UPDATE` or
  `DELETE` policy exists**, so those operations are rejected outright for
  every role via the Postgres API.
- Reconciliation is never silent: `contribution_records` and `repayments`
  both have a check constraint requiring `reconciled_by` and
  `reconciled_at` before a row can be marked `reconciled`.

## No silent deletion of financial records

Completed financial records are never deleted. Corrections are represented
as a new row referencing the original via `reversal_of`, with a mandatory
`reversal_reason` (enforced by check constraints on
`contribution_records`, `repayments`, and `withdrawal_requests`) — the
original entry, and the fact that it was corrected, both remain in the
permanent record.

## Credential handling

- **The Supabase service-role key is never used in this codebase.** It is
  documented in `.env.example` purely as a variable a future server-only
  process might need, and is explicitly called out in `src/lib/env.ts` as
  something that must never be referenced from client components or
  bundled into browser code.
- The browser Supabase client (`src/lib/supabase/client.ts`) is constructed
  with only the public URL and anon key — both safe to ship to the client
  because RLS is what actually protects the data behind them.
- WealthCircle does **not** store online-banking usernames, passwords, or
  full banking credentials anywhere in this schema. `documents` stores only
  a `storage_path` reference into Supabase Storage, never raw banking
  material.

## What this phase does not yet include

Rate limiting, CSRF-specific hardening beyond Next.js/Supabase defaults,
dependency/security scanning in CI, and a live Supabase project (with its
own project-level settings, e.g. leaked-password protection, MFA policy)
are all out of scope for Phase 1 and are called out again under "Issues
that still need attention" in the Phase 1 completion report.
