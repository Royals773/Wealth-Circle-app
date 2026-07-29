# Architecture

## Stack

- **Next.js 16** (App Router, Turbopack build), TypeScript in `strict` mode
- **Tailwind CSS v4**
- **shadcn/ui** (Radix UI primitives + `class-variance-authority`)
- **Supabase** — Postgres, Auth, Row Level Security (architecture is in
  place; no live project is connected in this delivery — see below)
- **Zod** for validation
- **React 19** Server Actions + `useActionState` for form handling

## Why these choices

- **App Router + Server Components by default.** Data-bearing pages (e.g.
  the members list, overview counts) are `async` Server Components that
  query Supabase directly with the signed-in user's session — there is no
  separate client-fetched API layer to keep in sync with RLS.
- **Server Actions instead of API routes** for mutations (sign-up, sign-in,
  group creation, invitations). Each action validates input with Zod on the
  server before touching Supabase, so validation cannot be bypassed by
  calling an endpoint directly.
- **Radix-based shadcn/ui** (as opposed to the newer Base UI preset) was
  chosen specifically so `Button`/`Link` composition via `asChild` works
  throughout the app — this is used extensively across the marketing site,
  auth screens and dashboard.

## Route structure

```
src/app/
  (marketing)/            Public site — header, footer, "/" homepage
  (auth)/                 Sign up, sign in, forgot/reset password,
                           verify email, accept invitation — no header/footer
  onboarding/              Guided group creation / join flow
  (dashboard)/dashboard/
    page.tsx               Redirects to the user's first group, or
                            onboarding if they have none
    [groupId]/             Group-scoped dashboard shell (sidebar + topbar)
      page.tsx              Overview
      contributions/ loans/ repayments/ members/ withdrawals/
      approvals/ governance/ reports/ notifications/ settings/
```

Route groups `(marketing)`, `(auth)`, `(dashboard)` each get their own
`layout.tsx` without affecting the URL path.

## Supabase-ready architecture (no live project required)

Every piece of Supabase integration is written so the app **builds and the
public site renders with zero environment variables set**:

- `src/lib/env.ts` — Zod-validated environment access. Supabase variables
  are typed as optional; nothing throws at import time when they're absent.
- `isSupabaseConfigured` (exported from `env.ts`) gates every place the app
  talks to Supabase. Server Actions and data loaders check it first and
  return a clear, honest message ("Supabase isn't configured yet…") instead
  of crashing or fabricating data.
- `src/lib/supabase/client.ts` — browser client (anon key only).
- `src/lib/supabase/server.ts` — server client for Server Components/Actions,
  backed by the request's cookies so RLS applies as the signed-in user.
- `src/lib/supabase/middleware.ts` + `src/proxy.ts` — refreshes the auth
  session on every request and redirects signed-out users away from
  `/dashboard` and `/onboarding`. No-ops entirely when Supabase isn't
  configured, so those routes remain browsable as a structural preview
  (clearly labelled as such in the UI) without a backend.
- `src/lib/types/database.ts` — hand-written types mirroring
  `supabase/migrations/0001_init.sql`. Once a real Supabase project exists,
  replace this file with `supabase gen types typescript` output — nothing
  else in the app needs to change because the shape matches.

**The service-role key is never referenced from any file under `src/`.**
It is documented in `.env.example` as server-only, for future use by
trusted server-side tooling (e.g. scheduled jobs), and is not used by
Phase 1 at all.

### `next dev`/`next build` without credentials

The homepage and every marketing/auth page are plain Server Components with
no required data fetch, so they render immediately. Dashboard pages that do
fetch data (`overview`, `members`, `notifications`, `settings`) check
`isSupabaseConfigured` and return zeroed/empty results instead of querying,
so `next build` never attempts a network call during static analysis, and
visiting them without credentials shows the real empty-state UI rather than
an error.

## Money, currency and time

- Amounts are stored and passed around as **integer minor units** (e.g.
  pence, cents) — see `src/lib/money.ts`, which is the only place
  major/minor unit conversion happens (`majorToMinorUnits`,
  `minorToMajorUnits`, `formatMoney`).
- Every amount column has a paired ISO 4217 `currency_code`.
- All timestamps are `timestamptz`, stored in UTC.

## Permissions

`src/lib/permissions.ts` defines the six group roles and a capability map
used to drive **UI** decisions (what to show/hide, which actions to offer).
It intentionally mirrors, but is not a substitute for, the Postgres RLS
policies in the migration — see
[security-boundaries.md](./security-boundaries.md) for why RLS is the real
boundary and this module is not.

## Testing

Vitest + Testing Library cover the parts of the foundation with real logic:
Zod validation schemas, the money conversion helpers, and the permissions
capability map. UI composition is verified by building the app and
visually checking key pages (see the Phase 1 completion report for
screenshots and findings) rather than with brittle snapshot tests at this
stage.
