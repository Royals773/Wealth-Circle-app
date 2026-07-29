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
