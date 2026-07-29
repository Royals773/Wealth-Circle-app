# WealthCircle

A multi-tenant platform for community savings groups, susu circles,
workplace groups, churches and associations, diaspora groups, and
investment clubs to manage contributions, loans, repayments, approvals
and governance decisions with clarity, accountability and confidence.

**WealthCircle is software-only.** It never holds, receives, transfers or
distributes members' money. Every group keeps its money in its own
external bank account — see [docs/product-brief.md](docs/product-brief.md).

This is Phase 2: Supabase authentication and multi-group onboarding are
now wired up. See [docs/mvp-roadmap.md](docs/mvp-roadmap.md) for what
comes next.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The public site,
and every page's structural preview (including `/dashboard/preview`),
render without any environment variables set. To exercise real
sign-up/sign-in, invitations and group data, set up Supabase — see below.

## Connecting Supabase (local setup)

WealthCircle needs its own **dedicated** Supabase project — don't reuse
credentials from another project.

1. Create a project at [supabase.com](https://supabase.com) (or via the
   Supabase CLI).
2. Apply the migrations in
   [`supabase/migrations/`](supabase/migrations/), in order, either by
   pasting each file into the Dashboard's SQL Editor and running it, or
   with the CLI:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. In the Dashboard, under **Authentication → URL Configuration**, set:
   - **Site URL**: `http://localhost:3000` (for local dev; your production
     URL once deployed)
   - **Redirect URLs**: add `http://localhost:3000/auth/callback` and
     `http://localhost:3000/auth/confirm` (plus the equivalents for any
     deployed URL)
4. Under **Authentication → Providers → Email**, confirm **"Confirm
   email"** is enabled — WealthCircle relies on verified email addresses
   for both sign-up and invitation acceptance (see
   [docs/security-boundaries.md](docs/security-boundaries.md)).
5. Copy `.env.example` to `.env.local` and fill in the **Project URL**
   and **Publishable key** from Project Settings → API. Leave
   `SUPABASE_SECRET_KEY` blank — nothing in this codebase uses it.
6. Restart `npm run dev`.

Full details, including what each migration does and why, are in
[docs/architecture.md](docs/architecture.md) and
[docs/data-model.md](docs/data-model.md).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build (also runs the TypeScript check) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run test` | Run the Vitest suite |

## Documentation

- [Product brief](docs/product-brief.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Security boundaries](docs/security-boundaries.md)
- [Permissions matrix](docs/permissions-matrix.md)
- [MVP roadmap](docs/mvp-roadmap.md)

## Database

The schema and Row Level Security policies live in
[`supabase/migrations/`](supabase/migrations/):

- `0001_init.sql` — the full Phase 1 schema (17 tables) with RLS.
- `0002_phase2_auth_functions.sql` — atomic, tightly-scoped database
  functions for group creation and the invitation lifecycle (see
  [docs/security-boundaries.md](docs/security-boundaries.md) for why
  these exist as database functions rather than sequential client-side
  inserts).
