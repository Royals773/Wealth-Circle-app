# Architecture

## Stack

- **Next.js 16** (App Router, Turbopack build), TypeScript in `strict` mode
- **Tailwind CSS v4**
- **shadcn/ui** (Radix UI primitives + `class-variance-authority`)
- **Supabase** — Postgres, Auth, Row Level Security. As of Phase 2, a
  dedicated Supabase project is connected for real authentication,
  onboarding and invitations — see "Supabase-ready architecture" below
  for how the app still degrades gracefully without one.
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
  auth/
    confirm/route.ts       token_hash-based email verification (OTP)
    callback/route.ts      PKCE `code` exchange
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
`layout.tsx` without affecting the URL path. `/dashboard/*` and
`/onboarding/*` are protected by `src/proxy.ts` — signed-out visitors are
redirected to `/sign-in?next=<original path>`.

## Authentication flow

- **Sign-up**: `signUpAction` (`src/lib/actions/auth.ts`) calls
  `supabase.auth.signUp()` with `emailRedirectTo` pointing at the final
  destination (e.g. `/onboarding`) — this becomes `{{ .RedirectTo }}` in
  the email template. The error message is deliberately identical
  whether the email is new or already registered (Supabase's
  `user_already_exists`/`email_exists` error codes are treated the same
  as success), so the form can't be used to enumerate accounts.
- **Email verification**: `src/app/auth/confirm/page.tsx` is a **two-step**
  confirmation page, not an auto-verifying route — this is a deliberate
  fix for a real bug found during manual testing (see
  [security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing)):
  a `GET` that verifies immediately is indistinguishable, from the
  server's perspective, from an email provider's automatic link-safety
  prefetch, which silently burns the single-use token before the
  recipient ever clicks. The page renders an explicit "Confirm" button;
  only submitting it (`confirmEmailAction`) calls `verifyOtp()`. Supabase's
  "Confirm signup" and "Reset Password" email templates must link here
  directly with `token_hash`/`type` — see security-boundaries.md for the
  exact template snippet. `src/app/auth/callback/route.ts` (PKCE `?code=`
  exchange) still exists for any future OAuth-provider redirect but is no
  longer used by the email flows. Both validate any `next` redirect
  target with `src/lib/safe-redirect.ts` before using it.
- **Sign-in**: `signInAction` validates and calls
  `supabase.auth.signInWithPassword()`, then redirects to a validated
  `next` if one was supplied (e.g. by the proxy bouncing a signed-out
  visitor), otherwise to `/dashboard` — which itself resolves to the
  user's first group or to `/onboarding` if they don't have one yet.
- **Sign-out**: `signOutAction` calls `supabase.auth.signOut()` (which
  clears the session cookies via the server client's cookie adapter) and
  returns to `/`.
- **Password reset**: `forgotPasswordAction` always reports success
  regardless of whether the address is registered. The reset link goes
  through the same two-step `/auth/confirm` page as email verification
  (with `type=recovery` and `next=/reset-password`), landing on
  `/reset-password` only after the explicit confirm step;
  `resetPasswordAction` checks a session actually exists before calling
  `updateUser()`, and maps an expired/invalid link to a plain-language
  message rather than a raw Supabase error.
- Every server-side "is this user authenticated" check uses
  `supabase.auth.getUser()`, never `getSession()` — `getUser()`
  revalidates the JWT against Supabase's auth server rather than trusting
  the cookie payload alone.

## Group creation and invitations

Both are implemented as Postgres functions in
`supabase/migrations/0002_phase2_auth_functions.sql`, called via
`supabase.rpc(...)`, rather than as sequential client-side `.insert()`
calls — see [security-boundaries.md](./security-boundaries.md) for the
full reasoning (atomicity, and why direct self-service `INSERT`s into
`group_memberships` are no longer allowed at all).

- `create_group_with_setup` — group + owner membership (via the existing
  trigger) + optional initial contribution plan + optional initial
  invitations + an audit log entry, in one transaction.
- `create_invitation` / `revoke_invitation` — manager-only (checked via
  `is_group_manager`), used by the Invite dialog and pending-invitations
  list on the Members page.
- `get_invitation_preview` — public, token-gated read used by the
  `/invitations/[token]` landing page before the visitor has an account.
- `accept_invitation` — the only way a user can add themselves to a
  group; validates the invitation and that the caller's verified email
  matches it before inserting the membership.

## Supabase-ready architecture (still works with zero credentials)

Even though a real Supabase project is now connected for Phase 2, every
piece of the integration is still written so the app **builds and the
public site renders with zero environment variables set** — useful for
CI, forks, and reviewing the UI structure without provisioning a backend:

- `src/lib/env.ts` — Zod-validated environment access
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_APP_URL`, `SUPABASE_SECRET_KEY`). Supabase variables are
  typed as optional; nothing throws at import time when they're absent.
- `isSupabaseConfigured` (exported from `env.ts`) gates every place the app
  talks to Supabase. Server Actions and data loaders check it first and
  return a clear, honest message ("Supabase isn't configured yet…") instead
  of crashing or fabricating data.
- `src/lib/supabase/client.ts` — browser client (publishable key only,
  PKCE flow).
- `src/lib/supabase/server.ts` — server client for Server Components/Actions,
  backed by the request's cookies so RLS applies as the signed-in user.
- `src/lib/supabase/middleware.ts` + `src/proxy.ts` — refreshes the auth
  session on every request and redirects signed-out users away from
  `/dashboard` and `/onboarding`. No-ops entirely when Supabase isn't
  configured, so those routes remain browsable as a structural preview
  (clearly labelled as such in the UI) without a backend. Once Supabase
  *is* configured (as it now is), this preview branch is simply dead code
  for that environment — every dashboard route goes through the same
  real auth + membership check as any other.
- `src/lib/types/database.ts` — hand-written types mirroring both
  migrations, including a typed `Functions` map for the Phase 2 RPCs.
  Regenerate with `supabase gen types typescript` once you want full
  fidelity with the live schema — see
  [data-model.md](./data-model.md#regenerating-typescript-types-from-a-live-project).

**No elevated key (`SUPABASE_SECRET_KEY`, formerly "service_role") is
referenced from any file under `src/`, in Phase 1 or Phase 2.** Every
Phase 2 feature that needs to act across the Row Level Security boundary
(previewing an invitation before signup, accepting one) does so through a
narrowly-scoped `SECURITY DEFINER` Postgres function instead — see
[security-boundaries.md](./security-boundaries.md).

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

Two layers:

- **Unit tests** (`npm run test`, Vitest): Zod validation schemas, the
  money conversion helpers, the permissions capability map, and the
  open-redirect guard in `src/lib/safe-redirect.ts`. These run with no
  Supabase project and are part of the standard build gate.
- **Live security tests** (`npm run test:security`, gated behind real
  Supabase credentials — see `tests/security/README.md`): exercise Row
  Level Security and the invitation lifecycle against an actual project
  using two real test users and two real test groups — tenant isolation,
  self-promotion prevention, revoked/expired/already-used invitations,
  and atomic group creation. Skipped automatically (not failed) when
  Supabase env vars aren't present, so the standard build/test gate never
  depends on a live project. All 13 currently pass against a live
  project; running this suite is what caught the two bugs fixed in
  `0003`/`0004` (see
  [security-boundaries.md](./security-boundaries.md#bugs-found-during-live-phase-2-testing)).

UI composition is verified by building the app and visually checking key
pages rather than with brittle snapshot tests at this stage.
