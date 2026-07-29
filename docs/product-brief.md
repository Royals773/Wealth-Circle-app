# WealthCircle — Product Brief

## Vision

WealthCircle is a multi-tenant SaaS platform for community savings groups —
friends and family circles, workplace groups, churches and associations,
diaspora groups, susu groups, and investment clubs. Many independent groups
register and use the platform side by side, and every group gets its own
private workspace: its own members, permissions, rules and financial
records, isolated from every other group.

**Working product promise:** *"Manage your group's savings, loans and
decisions with clarity, accountability and confidence."*

"WealthCircle" is a working name and the branding is intentionally simple
so it can change later without disrupting the underlying product.

## The financial boundary

This is the single most important constraint on the product, and it holds
for the entire Phase 1–7 roadmap unless a future phase explicitly revisits
it with the user's approval:

WealthCircle is a **software-only management system**. It does **not**:

- Hold members' money
- Receive deposits
- Transfer money
- Distribute money
- Initiate withdrawals
- Provide investment products
- Present itself as a bank or credit union

Each group keeps its money in its own external bank account. WealthCircle
**records and manages**: contributions, withdrawals, loans, repayments,
approvals, reconciliations, governance decisions, and financial reports —
i.e. the paper trail around the group's money, never the money itself.

See [security-boundaries.md](./security-boundaries.md) for how this is
enforced in the architecture, and [mvp-roadmap.md](./mvp-roadmap.md) for
what stays out of scope in every phase (§ "Explicit restrictions").

## Who it's for

- Community savings groups
- Friends and family savings groups
- Workplace groups
- Churches and associations
- Diaspora groups
- Susu groups
- Investment clubs

A person can belong to more than one group, and can hold a different role
in each group they belong to — see
[permissions-matrix.md](./permissions-matrix.md).

## Phase 1 scope (this delivery)

Phase 1 builds the product and technical foundation: the public marketing
site, the authentication screens (UI only, wired to Supabase Auth
architecture but with no live credentials), the guided group-onboarding
flow, the authenticated dashboard's information architecture with honest
empty states, the initial PostgreSQL schema with Row Level Security, and
this documentation set. It does not collect payments, move money, or
include any invented financial data. Full phase breakdown:
[mvp-roadmap.md](./mvp-roadmap.md).
