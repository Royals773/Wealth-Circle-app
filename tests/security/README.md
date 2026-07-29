# Live security tests

`tenant-isolation.test.ts` runs Row Level Security and invitation-lifecycle
assertions against a **real** Supabase project — not a mock. It is
intentionally kept out of the default `npm run test` (see
`vitest.security.config.ts` vs. the root `vitest.config.ts`) so the
standard build/lint/test gate never depends on network access or a live
project.

## What it needs

`.env.local` (never committed) with all four variables set:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

If any are missing, the suite reports as **skipped**, not failed.

`SUPABASE_SECRET_KEY` is used only in this folder, only for creating two
throwaway, pre-confirmed test users and deleting them (and their test
groups) afterward — the kind of narrow, genuinely backend-only need
`docs/security-boundaries.md` calls out as the one acceptable use of an
elevated key. Every actual assertion runs through a normal
publishable-key client signed in as one of those test users, so it
exercises the exact same RLS path the application does.

## Running it

```bash
npm run test:security
```

## What it covers

Using two real test users and two real test groups (created fresh on
every run, cleaned up in `afterAll`):

- Atomic group creation (group + owner membership together)
- A user can't read another user's profile without a shared group
- A member of one group can't read the other group's data (or vice versa)
- Anonymous (signed-out) requests can't read group data
- A user can't change their own `group_memberships` row (self-promotion)
- Full invitation lifecycle: create → preview (unauthenticated) → accept
- An accepted invitation can't be accepted again
- An ordinary member can't create invitations
- A revoked invitation can't be used
- An expired invitation can't be used
- A user who belongs to two groups gets the correct, independent role in
  each
- The audit log is readable by owners/administrators but not ordinary
  members

Test data uses `@example.com` addresses with a per-run random suffix and
is always deleted in `afterAll`, so nothing persists between runs.
