# Permissions Matrix

Source of truth: [`src/lib/permissions.ts`](../src/lib/permissions.ts) (UI
capability model) and
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
(the actual Row Level Security enforcement — see
[security-boundaries.md](./security-boundaries.md) for why these are two
different things).

Permissions are always tied to a user's **membership of one specific
group** (`group_memberships.role`). A person can belong to several groups
and hold a different role in each — there is no account-wide role.

## Roles

| Role | Summary |
|---|---|
| Group owner | Full authority: membership, settings, closing the group. |
| Administrator | Manages members, settings and day-to-day operations alongside the owner. |
| Treasurer | Records/verifies contributions, withdrawals, reconciliations. |
| Loan officer | Reviews loan applications, manages disbursed loans and repayments. |
| Auditor | Read access to records and the audit log to independently verify the books. |
| Ordinary member | Submits their own contributions/loan applications, votes on proposals. |

## Capability matrix

| Capability | Owner | Admin | Treasurer | Loan officer | Auditor | Member |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Manage group settings | ✅ | ✅ | | | | |
| Manage members | ✅ | ✅ | | | | |
| Manage contribution plans | ✅ | ✅ | ✅ | | | |
| Record contributions | ✅ | ✅ | ✅ | | | |
| Verify contributions | ✅ | ✅ | ✅ | | | |
| Request withdrawal | ✅ | ✅ | ✅ | | | |
| Approve withdrawal (2nd approver, never the requester) | ✅ | ✅ | ✅ | | | |
| Manage loan products | ✅ | ✅ | | ✅ | | |
| Review loan applications | ✅ | ✅ | | ✅ | | |
| Record repayments | ✅ | ✅ | ✅ | ✅ | | |
| Create governance proposal | ✅ | ✅ | | | | ✅ |
| Vote on proposal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View audit log | ✅ | ✅ | | | ✅ | |
| View reports | ✅ | ✅ | ✅ | ✅ | ✅ | |

Notes:

- Every member, including ordinary members, can submit their own
  contributions and loan applications (enforced at the RLS layer by
  `member_id = auth.uid()` / `applicant_id = auth.uid()` checks), even
  though the table above lists the *management* capabilities (recording
  on someone else's behalf, verifying, approving).
- Owner and administrator have identical capability grants — the RLS
  policies group them together via `is_group_manager()`. The distinction
  between the two roles is organisational (there is exactly one path by
  which a group gets its first owner — group creation), not a difference
  in what either can do.
- Two-person approval is a hard rule, not just a role gate: the same
  person can never be both the requester and an approver of the same
  withdrawal (`withdrawal_dual_approval_distinct` constraint), and
  `canApproveOwnRequest()` in `permissions.ts` always returns `false` as a
  standing reminder to any code that consumes it.
- As of Phase 2, "members cannot change their own role" is enforced at
  the database level, not just by omission from the UI: the
  `group_memberships` manage-members policy requires `user_id <>
  auth.uid()`, so even a manager cannot alter their own role or status
  through that path. See
  [security-boundaries.md](./security-boundaries.md#phase-2-rls-fixes-found-during-pre-deployment-review).
  As of Phase 7, there is exactly one exception: a member may transition
  their *own* row to `removed` (leaving the group) via a separate,
  narrower policy — but that policy's `WITH CHECK` only ever permits the
  `removed` transition, never a role change or any other status, and is
  itself blocked if the member is the group's last active owner.
- **"Manage members" (Owner/Administrator only) covers**: changing
  another member's role, suspending, reactivating, and removing them —
  but never a row currently holding `owner`, and never assigning
  `owner` directly. The only way a group's ownership changes is the
  two-step transfer workflow (current owner initiates, named recipient
  accepts or declines, either party's current owner can cancel while
  pending) — see
  [security-boundaries.md](./security-boundaries.md#member-and-role-management-integrity-phase-7).
  A group can never be left without an active owner: enforced by
  `active_owner_count()`, used identically in both RLS and the RPCs, not
  just counted client-side.
- **"View reports" is not perfectly uniform across the roles that hold
  it.** `contribution_records`' RLS (Phase 3) was never extended to
  `loan_officer` — only owner/administrator/treasurer/auditor — even
  though `loan_officer` has the `view_reports` capability. Rather than
  widen that RLS policy for one report, the Phase 8 group financial
  overview (which combines contribution data) is gated specifically to
  the roles that policy actually covers; a `loan_officer` sees an
  explanatory message there instead of a silently-incomplete total, but
  keeps full access to loan/repayment reports and detail (`loans`/
  `repayments`' RLS does include `loan_officer`) and every other
  `view_reports`-gated feature. See
  [security-boundaries.md](./security-boundaries.md#notification-and-reporting-integrity-phase-8).
