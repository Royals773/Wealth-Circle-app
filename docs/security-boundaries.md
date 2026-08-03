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

## Multi-person approval

- The generic `approval_requests` / `approval_decisions` pair (Phase 1)
  is the one real mechanism for this: one `approval_decisions` row per
  approver, unique per `(approval_request_id, approver_id)`, so the same
  person can never register two of the required decisions on one
  request. `approval_requests.required_approvals` makes the count
  configurable per subject, rather than hardcoded.
- **Withdrawals (Phase 6)** are the first real consumer.
  `withdrawal_requests` originally had hardcoded `approved_by_1`/
  `approved_by_2` columns sketched in Phase 1 — never wired to any RPC,
  and removed in `0011_phase6_withdrawals_governance.sql` in favour of
  routing every decision through `approval_requests`/`approval_decisions`,
  with the required count coming from the group's own
  `withdrawal_policies.required_approvals`. See "Withdrawal ledger
  integrity" below.
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
permanent record. On `contribution_records` specifically (Phase 3), this
is backed by more than a check constraint — see "Contribution ledger
integrity" below.

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

## Contribution ledger integrity (Phase 3)

`supabase/migrations/0006_phase3_contributions.sql` adds the write path
for the contribution ledger, following the same `SECURITY INVOKER` +
explicit role check + audit log pattern as the Phase 2 functions above:
`upsert_contribution_plan`, `record_contribution`, `verify_contribution`,
`reconcile_contribution`, `reject_contribution`, `reverse_contribution`.
None of them are `SECURITY DEFINER` — every one relies on RLS for the
real authorisation boundary and adds a friendly error only as a
convenience on top of it.

- **Members cannot create ledger entries.** `contribution_records`' old
  Phase 1 insert policy let a member insert a row for themselves; Phase 3
  removes that entirely — only `owner`/`administrator`/`treasurer` can
  insert, matching "members submit nothing; treasurers record what was
  actually received."
- **Members see only their own records.** The select policy was
  `member_id = auth.uid() OR has_group_role(..., [manager roles,
  auditor])` — a plain member's query for the group's contribution
  records returns only their own rows, verified directly in
  `tests/security/contributions.test.ts` ("lets a member see only their
  own contribution records, not the group's whole ledger").
- **Verified records are locked by more than RLS.** RLS controls *who*
  can run an `UPDATE`; a `before update` trigger,
  `protect_verified_contribution_record()`, controls *what* they can
  change once a record's status is `verified` or `reconciled` — any
  attempt to alter the amount, currency, member, period, received date,
  or payment method/reference on a locked record is rejected outright,
  even for an owner, even via a direct `.update()` call that bypasses the
  RPCs entirely. The only way out of that state is a transition to
  `reversed`, which the trigger explicitly permits.
- **Corrections are a new row, not an edit.** `reverse_contribution()`
  flips the original record's status to `reversed` and stamps
  `reversed_by`/`reversed_at`/`reversal_reason` — it never touches the
  original's financial fields. If a correction is needed, it inserts a
  **separate** row (`reversal_of` pointing back at the original) that
  re-enters the normal `pending_verification` → `verify` → `reconcile`
  workflow from scratch.
- **Currency mixing is structurally impossible, not just checked.**
  Neither `upsert_contribution_plan` nor `record_contribution` accepts a
  currency parameter at all — both always read and use the group's own
  `currency_code`. There is no code path, RPC argument, or client input
  that could ever record a contribution in a different currency from the
  rest of the group's ledger.
- **Totals are never trusted from the client.** `src/lib/contributions.ts`
  (`sumVerifiedAmount`, `computeMemberPeriodStatus`) and
  `src/lib/contribution-periods.ts` (period/due-date math) are pure
  TypeScript, unit-tested, and run only in Server Components against
  query results already scoped by the RLS policies above — a member's
  balance is always recomputed server-side from their own verified rows,
  never read from a value the browser sent.

## Editing a still-pending contribution (Phase 5)

`supabase/migrations/0010_edit_pending_contribution.sql` adds
`edit_contribution()`, filling the one real gap left in the Phase 3
ledger: correcting a typo in an entry before it's ever been verified,
without going through the heavier reversal workflow meant for records
that have already progressed further.

- **RLS already permitted this** — `protect_verified_contribution_record()`
  only fires its blocking logic for `verified`/`reconciled` rows, so a
  treasurer+ could already `UPDATE` a `pending_verification` row directly.
  The RPC exists purely so the change is audit-logged (`contribution_edited`),
  matching the "every mutation goes through an RPC" convention used
  everywhere else in this schema, not because RLS alone was insufficient.
- **`SECURITY INVOKER`, no bypass.** The RPC's own lookup of the target
  record is itself RLS-scoped — an officer from an unrelated group can't
  even see the row to reach the later role check; they get "record not
  found" rather than a permission error, but the edit is denied either
  way. Verified in `tests/security/contributions.test.ts`.
- **Explicit status gate.** Any attempt to edit a `verified`, `reconciled`,
  `rejected` or `reversed` record is rejected with a message pointing at
  the reversal workflow instead — edit is deliberately a narrow,
  pre-verification-only tool, not a general-purpose correction mechanism.

## Loan ledger integrity (Phase 4)

`supabase/migrations/0007_phase4_loans.sql` extends the Phase 1
`loan_products`/`loan_applications`/`loans`/`repayments` tables with
twelve `SECURITY INVOKER` RPCs, following the same pattern as Phase 2/3:
`upsert_loan_product`, `apply_for_loan`, `mark_loan_under_review`,
`decide_loan_application`, `cancel_loan_application`,
`record_disbursement`, `mark_loan_defaulted`, `record_repayment`,
`verify_repayment`, `reconcile_repayment`, `reject_repayment`,
`reverse_repayment`.

- **A real Phase 1 self-approval bug, found and fixed here.**
  `loan_applications`' original update policy was `has_group_role(...)
  OR applicant_id = auth.uid()` — if an applicant also held
  `loan_officer`/`administrator`/`owner` in the same group, the officer
  clause alone was sufficient to update *any* application, including
  their own, to `approved`. Fixed by splitting it into two policies:
  `loan_applications_decide_officers` requires both the officer role
  **and** `applicant_id <> auth.uid()`; `loan_applications_cancel_own`
  lets an applicant update only their own row, and only ever to
  `cancelled` (enforced by its `WITH CHECK`, not just its `USING`
  clause — an applicant attempting to set their own application to
  `approved` matches the `USING` clause but fails `WITH CHECK`, which
  Postgres reports as a real RLS violation rather than a silent no-op).
  `decide_loan_application()` additionally checks
  `applicant_id <> auth.uid()` itself, as defense-in-depth on top of the
  RLS fix — `tests/security/loans.test.ts` verifies both layers
  independently (a direct table `UPDATE` attempt, separately from the
  RPC call).
- **Members could previously read every other member's loan
  applications and loans.** Both tables' original select policies were
  member-of-group-only, no ownership check. Tightened to `borrower_id
  = auth.uid() OR officer role` (loans) and `applicant_id = auth.uid()
  OR officer role` (loan_applications) — the same class of fix Phase 3
  made to `contribution_records`.
- **Eligibility and the borrowing limit are enforced entirely inside
  `apply_for_loan()`, never trusted from the client.** It independently
  recomputes verified contributions, existing outstanding principal
  across the member's active loans, and the group's policy from the
  database on every call, and rejects any requested amount over the
  result — a crafted direct RPC call with an inflated amount is rejected
  exactly the same way the UI's own validation would have, because
  it's the same server-side check either way.
- **Approval never activates a loan.** `decide_loan_application()`
  creates the `loans` row as `awaiting_disbursement`; only
  `record_disbursement()`, callable only by an officer, transitions it
  to `active` — there is no path from "approved" straight to "active."
- **The overdue-contributions eligibility check uses exact calendar-period
  math, ported line-for-line from the TypeScript original — not an
  approximation.** This went through two iterations:
  - **Session 1** (`0007_phase4_loans.sql`): checked whether a verified
    contribution existed within roughly one repayment-frequency period
    (7/14/30/90/365 days) of today — a real, server-side,
    non-client-trusted check, but not calendar-exact the way the UI's
    own display (`computeMemberPeriodStatus` in
    `src/lib/contributions.ts`) is.
  - **Session 2, found during manual testing**
    (`0008_fix_apply_for_loan_overdue_check.sql`): the day-count version
    didn't account for *when the member joined* at all, so a member who
    joined very recently (before a single period had even elapsed for
    them) was incorrectly flagged as overdue on contributions they'd
    never had a chance to make. Fixed by only evaluating the check once
    `group_memberships.joined_at` was itself more than one period old —
    still an approximation, now a more correct one.
  - **Session 3** (`0009_exact_overdue_contribution_eligibility.sql`):
    replaced the approximation entirely with an exact PL/pgSQL port of
    `contribution-periods.ts`'s period math
    (`add_months_clamped`/`contribution_period_start`/
    `contribution_period_index`/`contribution_period_end`, faithfully
    reproducing the month-length-clamping and bounded-correction-walk
    logic, including leap years and 28th–31st due dates) and
    `contributions.ts`'s `computeMemberPeriodStatus` overdue rule
    (`member_has_overdue_contributions`, scanning every period since the
    later of the plan's start date or the member's own join date). The
    server-side decision and the displayed overdue status can no longer
    disagree — they're the same algorithm, expressed twice because SQL
    can't call TypeScript, with `tests/security/loan-eligibility-calendar.test.ts`
    proving both implementations produce identical period boundaries for
    the same inputs, plus end-to-end eligibility scenarios for join
    date, partial contributions, contribution-status filtering
    (pending/reversed must not count), and flexible plans with and
    without a minimum. The overdue-**repayments** check (a separate,
    narrower concern — whether a member's own loan has a missed
    instalment) still uses the day-count approximation; not in scope for
    this fix.
- **No stored `overdue`/`fully_repaid`/`partly_paid` status.**
  `loans.status` only ever holds `awaiting_disbursement`/`active`/
  `defaulted`/`cancelled` (a check constraint enforces this). Everything
  else is computed server-side from the repayment schedule and verified
  repayments (`src/lib/loans.ts`) — the same reasoning as Phase 3's
  contribution status, avoiding a flag that could go stale without a
  cron job this project doesn't run.
- **Verified/reconciled repayment records are locked the same way
  verified contributions are.** A `before update` trigger,
  `protect_verified_repayment_record()`, rejects direct edits to a
  repayment's financial fields once it's `verified`/`reconciled`, with
  the same single exception (a transition to `reversed`) as
  `protect_verified_contribution_record()` in Phase 3. Corrections are a
  new linked row via `reverse_repayment()`'s optional replacement, never
  an edit to the original.
- **One documented allocation policy.** Since one-time flat interest is
  the only supported interest type, every repayment splits between
  principal and interest in the loan's overall principal:total-repayable
  ratio (`computeProportionalAllocation` in `src/lib/loans.ts`, mirrored
  in the `record_repayment`/`reverse_repayment` RPCs) — not "interest
  first" or any other policy. This is stored per-repayment
  (`principal_portion_minor_units`/`interest_portion_minor_units`), not
  recomputed later, so it stays consistent even if a loan's terms were
  somehow queried again after the fact.

## Withdrawal ledger integrity (Phase 6)

`supabase/migrations/0011_phase6_withdrawals_governance.sql` (and its
follow-up correction, `0012_fix_withdrawal_reserved_balance.sql`) build
the write path on `withdrawal_requests`/`withdrawal_policies`, following
the same `SECURITY INVOKER` + explicit role check + audit log pattern
as every migration since `0002_phase2_auth_functions.sql`.

- **Members can request their own withdrawal; officers decide, never
  their own.** `withdrawal_requests_insert_own` requires `requested_by =
  auth.uid()`. The update policy is split exactly like `loan_applications`'
  self-approval fix in Phase 4: `withdrawal_requests_review_reviewers`
  requires `requested_by <> auth.uid()` in both `USING` and `WITH CHECK`,
  and `decide_withdrawal_request()`/`confirm_withdrawal_payment()` repeat
  the same check at the RPC layer as defense-in-depth.
- **Who counts as a "reviewer" is configurable per group, not
  hardcoded.** `is_withdrawal_reviewer(group_id)` (SECURITY DEFINER,
  same pattern as `has_group_role`/`is_group_manager`) checks the
  current user's role against that group's own
  `withdrawal_policies.reviewer_roles` array — used consistently across
  `withdrawal_requests`, `approval_requests`, and `approval_decisions`
  RLS policies, so a role that isn't a configured reviewer (even
  treasurer, by default included but removable) genuinely cannot decide
  or confirm payment, at the database level, not just hidden in the UI.
- **The available balance is always recalculated server-side, twice.**
  `request_withdrawal()` computes it fresh from verified ledger data at
  submission time; `decide_withdrawal_request()` recomputes it again
  once the required number of approvals is reached, in case the
  member's position changed in between (e.g. a new loan taken out) —
  never trusting the figure that was true when the request was first
  submitted.
- **The safest-default loan-protection rule is structural, not
  optional.** Available = verified contributions − outstanding loan
  principal − amounts already reserved by open requests or already
  paid out, floored at zero — a withdrawal can never leave a member's
  net verified contributions below their outstanding loan principal.
  **Real bug, found and fixed**: the initial `0011` implementation only
  subtracted *open* requests (submitted/under_review/approved/
  awaiting_payment) — once a request reached `paid_externally` it
  dropped out of that sum entirely, so a member's displayed and
  server-enforced available balance never decreased after being paid,
  meaning the same money could be requested again. Fixed in `0012` by
  including `paid_externally` in the sum; only a genuine reversal (which
  flips status to `reversed`) releases the hold. Found during the Phase
  6 manual walkthrough, not by the automated suites that ran first —
  covered by new live security tests afterward.
- **Approval must not automatically mean payment.** Reaching the
  required number of approvals moves a request to `awaiting_payment`,
  never directly to `paid_externally` — only `confirm_withdrawal_payment()`
  can make that transition, and it requires the paid amount to match
  the approved amount exactly, plus a bank reference, and enforces the
  policy's notice period.
- **Paid records are locked the same way verified contributions and
  repayments are.** `protect_paid_withdrawal_record()`, a `before
  update` trigger, rejects direct edits to a `paid_externally` record's
  financial fields, with the same single exception (a transition to
  `reversed`) as the Phase 3/4 triggers. `reverse_withdrawal_payment()`
  requires a reason and never edits the original record's amount.
- **One open request per member per group.** A partial unique index
  (`withdrawal_requests_one_open_per_member`, on
  `submitted`/`under_review`/`approved`/`awaiting_payment`) is both a
  sensible business rule and the concrete fix for duplicate-submission-
  on-retry — the same pattern as `loan_applications_one_open_per_member`
  in Phase 4.

## Governance integrity (Phase 6)

- **One vote per eligible member is a database constraint, not just
  application logic.** The `unique (proposal_id, voter_id)` constraint
  on `votes` (Phase 1, unchanged) is what actually prevents a double
  vote; `cast_vote()`'s own check is a friendlier error on top of it.
- **Voter eligibility is a join-date comparison, computed server-side.**
  A member can vote only if their `group_memberships.joined_at <=
  proposal.voting_opens_at` — the same point-in-time approach already
  used for contribution/loan eligibility, rather than a separate
  physical snapshot table.
- **Material terms are locked once voting opens.** There is deliberately
  no `update_proposal()` RPC for title, description, dates, or
  thresholds — only `cancel_governance_proposal()`, and even that is
  restricted once voting has started: the proposer can only withdraw
  their own proposal *before* voting opens
  (`governance_proposals_cancel_own_before_voting`); an owner/
  administrator can cancel at any time
  (`governance_proposals_cancel_managers`).
- **Live vote visibility is restricted while voting is open, not just
  vague "results appear later."** The original Phase 1 `votes` SELECT
  policy let any group member read every other member's individual
  vote at any time — a real gap, never exercised until this phase.
  Replaced with two policies: a member always sees their own vote (and
  owners/administrators/auditors always see everything, for audit
  purposes); everyone sees the full result only once
  `now() >= voting_closes_at`. Multiple permissive `SELECT` policies on
  the same table are combined with `OR` by Postgres, so this reads as
  "own vote, or privileged role, or the window has closed."
  **Real UI bug, found and fixed**: the Governance page originally let
  any signed-in member click through to a "current tally" view — since
  the underlying `votes` query was already correctly RLS-restricted to
  their own vote while open, what displayed was their own single vote
  dressed up with turnout percentages and a for/against/abstain
  breakdown, looking like the complete result when it wasn't. Fixed by
  computing a `canSeeFullTally` flag server-side (mirroring the RLS
  policy: manager or auditor) and only rendering a tally at all when
  that's true or voting has actually closed — a plain member now sees
  an explicit "results stay private until voting closes" message
  instead of misleading partial data.
- **A large withdrawal can require a passed vote first, enforced
  server-side.** `withdrawal_policies.large_withdrawal_threshold_minor_units`,
  when set, requires `request_withdrawal()` to be given a
  `p_linked_proposal_id`; `decide_withdrawal_request()` then calls
  `compute_proposal_passed()` (a SQL-level mirror of
  `src/lib/governance.ts`'s `computeProposalResult` — SQL can't call
  TypeScript) and refuses to approve until it returns true. This
  function is `SECURITY DEFINER` specifically so the approval-time
  check isn't itself blocked by the votes-visibility restriction above
  — the only privileged read in this phase, narrowly scoped to a single
  boolean.

## Member and role management integrity (Phase 7)

- **A real, unfixed Phase 1 RLS gap, closed by construction.** The
  original `group_memberships_update_managers` policy checked "is the
  actor a manager, and is the target not themselves" for `USING`, but
  never checked the target row's *current* role — so an administrator
  could in principle have demoted, suspended, or removed an existing
  owner. No RPC ever exercised this before this phase (none existed),
  but the policy itself was live and wrong. Replaced with two narrower
  policies (the same split-policy pattern used for the Phase 4 loan
  self-approval fix): `group_memberships_manage_non_owners` (a manager
  may change another member's role/status, but only when the target's
  *current* role isn't `owner` and the *new* role isn't `owner` either)
  and `group_memberships_leave_own` (a member may transition their own
  row to `removed`, blocked by `active_owner_count()` if they're the
  last active owner). Owner rows are now structurally outside the reach
  of the general manage-members policy in both directions — the only
  way to change an owner's status is the ownership-transfer workflow
  below, never a direct RPC call by anyone else.
- **Suspension revokes read access, not just write access, and does so
  for free.** `is_group_member()`, `has_group_role()`, and
  `is_group_manager()` — the three Phase 1 helper functions every RLS
  policy in the entire schema already calls — all filter on
  `status = 'active'`. Widening them to also accept `'suspended'` would
  have meant touching every table's RLS for one edge case; instead,
  Phase 7 relies on the fact that they already don't, so a suspended
  member loses access to their group's data everywhere, the instant
  their status changes, with zero additional RLS changes anywhere else
  in the app. No session invalidation is needed — the next request from
  a suspended member simply fails RLS like any other unauthorised
  request. Officers retain full visibility into a suspended member's
  history at all times; suspension never deletes or hides data from
  people who are still allowed to see it.
- **Last-owner protection is enforced structurally, not counted in the
  browser.** `active_owner_count(group_id)` is a single `SECURITY
  DEFINER` SQL function, used identically inside the
  `group_memberships_leave_own` policy's `WITH CHECK` clause and inside
  `leave_group()`'s own explicit check — the same count, evaluated the
  same way, in both the database-level guard and the friendlier
  application-level error message.
- **`member_removal_blockers(group_id, user_id)`** is `SECURITY
  DEFINER` so it can read across `loans`, `loan_applications`,
  `repayments`, `withdrawal_requests`, and `ownership_transfers`
  regardless of the caller's own RLS visibility into each of those
  tables individually — but it re-implements its own authorisation
  check inside the function body (group manager, or the subject
  themselves) rather than relying on the caller's ambient RLS access,
  since that access is inconsistent across the five tables it queries.
  It's the shared definition of "unsafe to remove" used by both
  `remove_member()` and `leave_group()`, so the two can never disagree
  about what blocks a departure.
- **`accept_ownership_transfer(transfer_id)`** is the third narrowly-
  scoped `SECURITY DEFINER` function in the app (alongside
  `accept_invitation` and `get_invitation_preview` from Phase 2),
  justified the same way: a user must be able to promote *themselves*
  to `owner` and demote *another* user (the outgoing owner) in one
  transaction, neither of which ordinary RLS on `group_memberships`
  allows anywhere else in the schema — by design. Every check that
  would normally live in an RLS policy is re-implemented explicitly in
  PL/pgSQL instead: the transfer must be `pending` and unexpired (lazy
  expiry, the same pattern as `accept_invitation`), the caller must be
  the transfer's intended recipient, and both parties are re-verified
  as active group members immediately before either row is touched.
- **One pending ownership transfer per group, enforced by a unique
  partial index** (`ownership_transfers_one_pending_per_group`, `where
  status = 'pending'`) rather than an application-level check — the
  same duplicate-submission protection pattern already used for
  `loan_applications_one_open_per_member` and
  `withdrawal_requests_one_open_per_member`.
- **Bug found during live testing, fixed in
  `0014_fix_member_management_owner_lock_visibility.sql`**:
  `change_member_role()`, `suspend_member()`, and `remove_member()`
  each looked up the target row with `select ... for update` before
  deciding what to do. Under Postgres RLS, `SELECT ... FOR UPDATE` must
  satisfy not only the `SELECT` policy but also the `USING` clause of
  any applicable `UPDATE` policy — and the only `UPDATE` policy covering
  these rows (`group_memberships_manage_non_owners`) deliberately
  excludes `role = 'owner'`. So locking a target row that currently held
  `owner` silently returned no row, and the code fell through to a
  generic "Member not found in this group" instead of the intended
  "...owner cannot be suspended/removed..." / "...ownership transfer
  workflow..." message. The action was still correctly blocked either
  way — RLS did its job regardless of which code path raised the error
  — so this was never a security gap, only a misleading message. Fixed
  by dropping `for update` from those three lookups; the later `update`
  statement still serializes concurrent writes to the same row on its
  own, so no locking guarantee was actually lost.

## Notification and reporting integrity (Phase 8)

- **`create_notification()`** is the fourth narrowly-scoped `SECURITY
  DEFINER` function in the app (alongside `accept_invitation`,
  `get_invitation_preview`, and `accept_ownership_transfer`), justified
  the same way: it writes a row for a recipient who is usually not the
  caller, which no general RLS policy should allow. It's idempotent via
  a `dedupe_key` column with a partial unique index
  (`unique (recipient_id, dedupe_key) where dedupe_key is not null`) —
  every call site passes a key scoped to the specific event (e.g.
  `contribution_verified:<record_id>`, or
  `overdue_contribution:<member_id>:<group_id>:<date>` for the
  date-scoped reminder functions), so retries and the reminder
  functions re-running can never create duplicate notifications.
- **Email delivery is bounded to shared-group recipients, not a general
  "browse all pending notifications" capability.** Postgres can't send
  SMTP, so actually delivering an email is necessarily a Next.js-layer
  side effect — `claim_pending_notification_emails()` (`SECURITY
  DEFINER`) atomically claims a batch of `pending` rows (flipping them
  to `sending` so two concurrent flush calls can never send the same
  email twice) but only returns rows whose recipient shares a group
  with the calling user, the same kind of narrowing
  `member_removal_blockers()` already uses — bounding what a flush
  triggered by one user's action could ever expose about another user's
  notifications. `mark_notification_email_result()` only ever
  transitions a row already `sending` (i.e. one actually claimed), and
  only to `sent` or `failed`.
- **Email content is deliberately generic.** The email template uses
  only the notification's `title` (kept non-sensitive at creation time
  — e.g. "A contribution was verified in Riverside Savings", never an
  amount) plus a sign-in link back to the relevant section page; the
  fuller `body` (which may include amounts) is shown only in-app, after
  the recipient authenticates and RLS re-applies. This is also why
  notification links point at section pages, never record-specific
  URLs — "recheck permission at the destination" is structural, not a
  convention to remember, since every section page already goes through
  the app's normal auth + RLS path regardless of how the visitor
  arrived there.
- **Preferences gate email only, never the in-app notification**, and
  cannot silently disable the two essential categories (`membership`,
  `ownership_transfer`) — `create_notification()` hardcodes those as
  always-email regardless of what preference row exists, and the
  `setNotificationPreferenceAction` Server Action refuses to write a
  preference row for them at all, as defense-in-depth on top of the
  database-level enforcement.
- **`SUPABASE_SECRET_KEY` still never appears anywhere under `src/`.**
  The scheduled reminder functions (`send_overdue_contribution_reminders()`,
  `send_overdue_repayment_reminders()`, `send_governance_deadline_reminders()`,
  `expire_stale_invitations()`, `expire_stale_ownership_transfers()`) are
  all `SECURITY DEFINER` because they scan across every group, not just
  a caller's own — but nothing in the application calls them; they're
  tested by calling them directly with the same admin/service-role
  client `tests/security/*.test.ts` already uses for setup/teardown.
  Actually wiring a scheduler to call them periodically is Phase 9's
  job.
- **CSV export re-derives every report from the same server-side
  loaders and filters the on-screen version uses** — a Route Handler,
  not a Server Action, since a real file download needs genuine HTTP
  response headers (`Content-Disposition`). Every export logs an
  `audit_logs` row (`report_export_generated`) before streaming.
  `src/lib/csv.ts`'s `escapeCsvCell()` guards any cell beginning with
  `=`, `+`, `-`, or `@` (the character classes spreadsheet formula
  injection relies on) by prefixing a single quote, and rows are capped
  at 10,000 with a visible truncation notice rather than attempting an
  unbounded in-memory export.
- **Bug found during live testing: two regressions, both introduced by
  this phase's own migration.** `0015_phase8_reports_notifications_audit.sql`'s
  edits to `accept_invitation()`, `request_withdrawal()`, and
  `decide_withdrawal_request()` were each based on the *original*
  function body from the migration that first defined them (`0002`,
  `0011`), not the already-corrected version from a later bug-fix
  migration (`0004`'s ambiguous-column fix, `0012`'s withdrawal-balance
  fix) — silently reintroducing both previously-fixed bugs. The first
  live test run caught the `accept_invitation` regression immediately
  (Postgres error 42702, identical to the original `0004` bug); a
  systematic cross-check of every one of the 26 existing functions this
  migration touched, against the full migration history, confirmed
  these were the only two affected. Fixed in
  `0016_fix_accept_invitation_ambiguous_column_regression.sql` — three
  pure `create or replace function` statements, each re-applying the
  correct historical fix with the new notification call kept on top.
  **Lesson applied going forward**: when a function has been patched by
  a later migration, any subsequent edit must be based on that later
  version, never the version in the migration that originally defined
  it.
- **A real, non-regression gap found and fixed: `loan_officer` and the
  group financial overview.** `contribution_records`' RLS (Phase 3) was
  never extended to `loan_officer` — only owner/administrator/treasurer/
  auditor. But `loan_officer` has the `view_reports` capability
  (`src/lib/permissions.ts`), which the Reports page and export route
  originally used as the sole gate for the group financial overview —
  a report that combines contribution figures with loan and withdrawal
  data. A `loan_officer` viewing it would have silently seen
  RLS-truncated contribution totals (their own row only, or none)
  presented as if they were the complete group figures, with no error
  to indicate anything was missing — the same class of bug as Phase 6's
  vote-tally visibility issue. Fixed by gating the overview specifically
  to the roles `contribution_records`' RLS actually covers, both on the
  page (`canViewFinancialOverview`) and in the export route handler —
  `loan_officer` still sees everything else `view_reports` grants
  (specialist CSV exports, membership/governance data, their own
  statement) and retains full detail on the existing Loans page, which
  was never affected since `loans`/`repayments`' RLS already includes
  `loan_officer`.

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

Real, executed tests against a live Supabase project — the automated live
security suite (`tests/security/`, 13 tests, two real users, two real
groups) and later a manual click-through smoke test — caught bugs that
RLS design review and unit tests could not, because each required an
actual Postgres/PostgREST round trip, or a real email round trip, to
surface. Fixed in follow-up migrations applied after `0001`/`0002` on the
live project (rather than rewritten into already-deployed history) or in
application code, as appropriate:

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
- **`0005_fix_onboarding_invite_links_lost.sql`** —
  `create_group_with_setup()` called `create_invitation()` for each
  initial invite using `perform`, which discards the function's return
  value — including the one-time raw token. Since only a hash of the
  token is ever stored (see below), this made every invitation created
  during onboarding permanently unusable — created in the database, but
  with no way for anyone to ever construct a working link to it. Fixed by
  collecting and returning each invite's raw token, and the onboarding
  wizard now shows a one-time "copy these links" screen before navigating
  away.
- **Server Actions exporting a plain constant** — every `"use server"`
  action file also exported an `initial*ActionState` object for
  `useActionState` to consume. Next.js requires every export from a
  `"use server"` file to be an async function; this broke *every* form
  submission in the app at runtime (sign-up, sign-in, onboarding, invite
  creation — everything), and `next build` never caught it, because the
  violation only surfaces when the action module is actually invoked, not
  during build analysis. Only driving the real UI in a browser caught it.
  Fixed by moving the initial-state constants to a separate, non-`"use
  server"` module (`src/lib/actions/action-state.ts`).
- **Email confirmation vulnerable to link prefetching** — found during
  manual smoke testing, not automated testing. The original flow relied
  on Supabase's hosted `{{ .ConfirmationURL }}` verify-and-redirect,
  which consumes the single-use signup/recovery token on the first `GET`
  request to it. Many email providers and corporate security gateways
  automatically fetch links in incoming mail to scan them for safety
  *before* the recipient ever opens the message, which silently burns the
  token — the user's real click then fails with `otp_expired`. Fixed by
  replacing the auto-verifying route with a two-step confirmation page
  (`src/app/auth/confirm/page.tsx`): the `GET` only renders a page with an
  explicit "Confirm" button; the token is verified only by the follow-up
  `confirmEmailAction`, which fires solely on that explicit user click. A
  prefetch now just loads a harmless static page. Supabase's "Confirm
  signup" and "Reset Password" email templates must point at this route
  directly (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash
  }}&type=signup&next={{ .RedirectTo }}`) rather than the default
  `{{ .ConfirmationURL }}` — see the Phase 2 smoke-test record for
  current status of that dashboard change.

None of these bugs allowed unauthorized access — all were
denial-of-legitimate-access failures (the opposite failure mode from a
security hole), each caught before it could affect a real user.

## Production hardening (Phase 9)

**CSRF.** Every mutation in the app goes through Next.js Server Actions
(never a custom fetch/form-POST to a hand-rolled API route), which have
Origin-vs-Host same-origin checking on by default — confirmed
unoverridden (`experimental.serverActions.allowedOrigins` unset in
`next.config.ts`). The one new HTTP endpoint this phase adds
(`/api/scheduler/run`) is deliberately *not* browser-invoked — it's a
machine-to-machine call authenticated by a bearer secret — so CSRF
doesn't apply to it; the relevant protection there is the secret
comparison, done with `crypto.timingSafeEqual` to avoid a timing side
channel, not same-origin checking.

**Session cookies.** `@supabase/ssr`'s default cookie settings
(httpOnly, secure in production, `sameSite=lax`) are unoverridden
anywhere in `src/lib/supabase/`. Session/refresh-token lifetime and
rotation policy are Supabase project (Dashboard) settings, not
application code — a UX-vs-exposure trade-off for whoever operates the
project to set, not something this codebase decides.

**Security headers and CSP.** `next.config.ts` now sets
`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`, and a static (no-nonce)
Content-Security-Policy on every route. Static rather than nonce-based
deliberately: nonces require setting them per-request in `src/proxy.ts`
(Next 16's renamed middleware) and force full dynamic rendering on every
matched page, which would cost the marketing route group its static
optimization for no real benefit — the app loads no third-party scripts.
Both `script-src` and `style-src` need `'unsafe-inline'` — this is
Next.js's own documented default for apps not using nonces (see
`node_modules/next/dist/docs/.../content-security-policy.md`, "Without
Nonces"). **A real bug found during staging deployment testing**: an
earlier version of this CSP omitted `'unsafe-inline'` from `script-src`
specifically, on the (wrong) assumption that only app-authored inline
scripts mattered and this app ships none. In fact Next.js's own
framework bootstrap (RSC payload streaming, hydration data) injects
inline `<script>` tags on every page load regardless of app code —
without `'unsafe-inline'` in `script-src`, the browser silently blocked
those, breaking React hydration app-wide. Every client component
stopped responding to interaction (confirmed via direct, automated
browser testing: a Radix Checkbox's `data-state` never changed from
`"unchecked"` after a real click), with zero build-time signal that
anything was wrong — `next build` succeeds either way, since CSP is a
runtime browser enforcement, not a build-time check. Nonce-based or
experimental SRI-based CSP remain available as stricter future upgrades
if ever wanted (see the Next.js CSP guide's "Without Nonces" vs.
"Nonces" vs. "Subresource Integrity" sections), at the cost of forcing
dynamic rendering (nonces) or App-Router-only experimental status (SRI).

**Rate limiting.** A Postgres-backed fixed-window limiter
(`check_rate_limit()`, `supabase/migrations/0017_phase9_rate_limiting.sql`)
covers the surfaces that had no protection: invitation creation, the
pre-auth invitation-preview/accept flow (rate-limited by IP, since no
session exists yet), and CSV export. Deliberately Postgres, not a new
Redis/Upstash-style service — right-sized for MVP traffic, and follows
the same narrowly-scoped-`SECURITY DEFINER`-function pattern as every
other privileged operation in this app rather than adding new paid
infrastructure. `src/lib/rate-limit.ts` fails **open** by default on any
unexpected error (availability matters more than a missed check for
most gated actions) and always fails open specifically when the
function itself isn't deployed yet (`PGRST202`) — the one exception is
the invitation-preview path, which fails **closed**, since that's the
actual credential-adjacent, token-guessing surface. Supabase Auth's own
sign-in/sign-up/password-reset endpoints have their own separate,
opaque-to-this-codebase rate limits and are out of scope here.
Edge/CDN-level rate limiting (Cloudflare, a host's built-in edge
limiting) is a future escalation if real abuse appears — not needed for
MVP launch.

**Scheduled jobs.** The five reminder/expiry functions from Phase 8
(`send_overdue_contribution_reminders`, `send_overdue_repayment_reminders`,
`send_governance_deadline_reminders`, `expire_stale_invitations`,
`expire_stale_ownership_transfers`) are now callable via
`/api/scheduler/run`, gated by a `SCHEDULER_SECRET` bearer token — a
dedicated shared secret, distinct from and no more powerful than
`SUPABASE_SECRET_KEY`, since it only gates one HTTP call, not database
access. The endpoint itself signs in as an ordinary, unprivileged
Supabase Auth account (no group memberships) to call the existing
`authenticated`-granted RPCs, the same "narrow function, not an elevated
bypass key" pattern as every other privileged operation described
throughout this document — `SUPABASE_SECRET_KEY` still never appears
anywhere under `src/`. **Known, accepted gap:** none of the five
functions currently check caller identity internally (no `auth.uid()`
reference), so any authenticated session — not just the scheduler
account — can invoke them today. Left as-is deliberately: each call is
idempotent (`create_notification()`'s `dedupe_key` unique index makes a
duplicate call a no-op), returns only an integer count, and exposes no
data beyond that count. Worth closing with an internal caller check in
a fast-follow migration once the scheduler account actually exists (it
must be provisioned via the Supabase Dashboard, which this codebase
cannot do), but the severity does not justify blocking Phase 9 on it.

**Email delivery.** `src/lib/email/mailer.ts` is now provider-agnostic
generic SMTP (`EMAIL_SMTP_*`, renamed from `MAILTRAP_*`) rather than a
Mailtrap-specific code path — Mailtrap remains the recommended
*development* sandbox value for these variables, but the code makes no
distinction; production must point them at a real transactional
provider's credentials, a deliberate, separately-approved decision (see
`docs/phase-9-deployment-checklist.md`), never Mailtrap's sandbox.

**Logging.** `src/lib/logger.ts` is the first error-visibility mechanism
of any kind in this codebase (previously: zero `console.error` calls
anywhere in `src/`). Structured, minimal, and deliberately disciplined
against becoming an unreviewed second copy of financial/PII data
outside `audit_logs`' already-RLS-reviewed boundary — never raw
amounts, a full name plus financial history together, or a token/secret
in the same call. Its `reportError()` seam is a no-op until a real
error-reporting vendor is chosen (see `docs/phase-9-deployment-checklist.md`).

**CI.** `.github/workflows/ci.yml` now runs typecheck/lint/build/unit
tests plus `npm audit` (warn-only for now) on every push/PR, needing no
Supabase credentials at all. The live security-test job is deliberately
left `workflow_dispatch`-only (manual trigger) until a dedicated,
non-production Supabase project is provisioned and approved for CI use
— it must never run against production, since it creates and deletes
real rows including real Supabase Auth users via the admin API, and an
interrupted run can leave residue (exactly this happened once during
this project's own manual Phase 8 testing — see
`docs/phase-8-smoke-test.md`).

## What this phase does not yet include

Edge/CDN-level rate limiting, the internal-caller check on the five
scheduled-job RPCs (see above), and a chosen/configured error-reporting
vendor are still open. See "Remaining risks or limitations" in the
Phase 2 completion report for the original, broader list — including
any Supabase Security Advisor findings from the live project.
