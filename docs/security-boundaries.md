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

## Phase 2 RLS fixes (found during pre-deployment review)

Phase 1's migration had never been applied to a live database, so the
following were fixed directly in `0001_init.sql` rather than patched in a
later migration — there was no live schema to migrate away from:

- **Arbitrary self-join.** The original `group_memberships` insert policy
  allowed `user_id = auth.uid()` as an alternative to being a group
  manager — meaning any authenticated user could have inserted themselves
  into *any* group with *any* role, including `owner`. Fixed by removing
  that clause entirely; the only way a user can now add themselves to a
  group is `accept_invitation()` (see below), which validates a specific,
  single-use invitation first.
- **Self-promotion.** The original `group_memberships` update policy let
  a manager update any row in their group, including their own — an
  administrator could update their own row's `role` to `owner`. Fixed by
  adding `user_id <> auth.uid()` to both the `USING` and `WITH CHECK`
  clauses, so managers can change *other* members' rows but never their
  own. Promoting someone else *to* `owner` additionally requires the
  actor to already be an owner, so an administrator can't unilaterally
  create co-owners.
- **Audit log forgery.** The original `audit_logs` insert policy checked
  only group membership, not who the row claimed to be the actor —
  meaning a member could insert an audit row with `actor_id` set to
  someone else. Fixed by requiring `actor_id is null or actor_id =
  auth.uid()`.
- **Plaintext invitation tokens.** The original `group_invitations.token`
  column stored the literal token used in invitation links. Replaced with
  `token_hash` (SHA-256), populated only by `create_invitation()` — see
  below.

## Invitation tokens: hash-only storage

`create_invitation()` generates 32 cryptographically random bytes
(`pgcrypto`'s `gen_random_bytes`), hex-encodes them as the raw token, and
stores only `sha256(raw_token)` in `group_invitations.token_hash`. The raw
token is returned to the caller exactly once, at creation time, for
building the invitation link — a database read (or a leaked backup) can
never itself be used to accept an invitation. The practical tradeoff
(explicitly anticipated by "store a hash where practical"): once the
creation dialog is closed, the raw link cannot be re-displayed for an
existing pending invitation — only revoked and replaced with a new one.

## Two narrowly-scoped SECURITY DEFINER functions

Every other Phase 2 database function (`create_group_with_setup`,
`create_invitation`, `revoke_invitation`) is `SECURITY INVOKER` — it runs
as the calling user and relies entirely on the RLS policies above for
authorisation; it exists only to make a multi-step operation atomic and
to attach an audit log entry, never to bypass RLS. Exactly two functions
are `SECURITY DEFINER`, each justified by a specific gap RLS can't cover
for a person who isn't yet (or isn't visibly) a group member, and each
scoped to one validated operation — never a general bypass:

- **`get_invitation_preview(token)`** — lets a visitor with no account
  yet see "You've been invited to join X as Y" before signing up.
  Authorised purely by knowledge of the correct 256-bit token; returns
  only the group name, role, invited email and status — never the
  `group_id`, `invited_by`, or the token itself.
- **`accept_invitation(token)`** — the only path by which a user can add
  themselves to a group (see "arbitrary self-join" above). Row-locks the
  invitation (`for update`) so two concurrent accepts of the same token
  can't both succeed, checks status and expiry, and compares the caller's
  *verified* `auth.users.email` against the invitation's email before
  inserting the membership with the role taken from the invitation row —
  never from client input.

Both set `search_path = ''` and fully qualify every object they touch
(including `extensions.gen_random_bytes`/`extensions.digest`), the
Postgres/Supabase-recommended defence against search-path hijacking in
`SECURITY DEFINER` functions.

## Atomic group creation

`create_group_with_setup()` creates the group row, its owner membership
(via the existing `groups_after_insert_create_owner_membership` trigger,
which fires synchronously within the same statement), an optional initial
contribution plan, optional initial invitations, and an audit log entry —
all inside one PL/pgSQL function invocation, which Postgres executes as
part of a single transaction. If any step fails (e.g. a duplicate slug),
the whole call rolls back and nothing is created; there is no
intermediate state where a group exists without an owner. The Next.js
Server Action that calls it (`createGroupAction`) makes exactly one
`supabase.rpc()` call — no sequential client-side `.insert()`s.

## Trusted session verification

Every server-side "is this user authenticated" check — in Server
Components, Server Actions, and `src/proxy.ts` — uses
`supabase.auth.getUser()`, which revalidates the JWT against Supabase's
auth server, never `getSession()`, which only reads the (spoofable, from
a compromised-cookie perspective) local cookie payload without
revalidation.

## Open redirect prevention

`next`-style redirect targets (used by the proxy when bouncing a
signed-out visitor, and by sign-in to return them afterwards) are always
validated by `src/lib/safe-redirect.ts` before use: only same-origin,
relative paths are accepted; absolute URLs, protocol-relative `//host`
URLs, and anything containing `://` fall back to a safe default.

## Bugs found during live Phase 2 testing

The live security suite (`tests/security/`, 13 tests against a real
Supabase project with two real test users and two real test groups)
caught two real bugs that the RLS design review and unit tests could not
have — both required an actual Postgres/PostgREST round trip to surface,
which is exactly why the live suite exists alongside the design review.
Both are fixed in follow-up migrations, applied after `0001`/`0002` on
the live project rather than rewritten into already-deployed history:

- **`0003_fix_group_creation_visibility.sql`** — `groups_select_members`
  only granted access via an existing `group_memberships` row. The
  creator's owner membership is inserted by an `AFTER INSERT` trigger,
  which had not yet run at the moment PostgreSQL re-checks SELECT-policy
  visibility for an `INSERT ... RETURNING` clause on the same statement
  — so creating a group and asking for it back in the same call always
  failed, for every group, every time. Fixed by also allowing a row's own
  creator to see it (`created_by = auth.uid()`), which grants no more
  than the trigger already guarantees them moments later as owner.
- **`0004_fix_accept_invitation_ambiguous_column.sql`** —
  `accept_invitation()` declares `returns table (group_id uuid, role
  text)`, which makes `group_id` an implicit variable in scope for the
  *entire* function body, not just the final `return query`. An
  unqualified `group_id` inside a membership-existence check collided
  with it (Postgres error 42702, "ambiguous column reference"), so the
  function failed for every caller. Fixed by qualifying the column with a
  table alias.

Neither bug allowed unauthorized access — both were straightforward
denial-of-legitimate-access failures (the opposite failure mode from a
security hole), caught before any real user could hit them.

## What this phase does not yet include

Rate limiting, CSRF-specific hardening beyond Next.js/Supabase defaults,
and dependency/security scanning in CI are still out of scope. See
"Remaining risks or limitations" in the Phase 2 completion report for the
current, specific list — including any Supabase Security Advisor findings
from the live project.
