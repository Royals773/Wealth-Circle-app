# WealthCircle

A multi-tenant platform for community savings groups, susu circles,
workplace groups, churches and associations, diaspora groups, and
investment clubs to manage contributions, loans, repayments, approvals
and governance decisions with clarity, accountability and confidence.

**WealthCircle is software-only.** It never holds, receives, transfers or
distributes members' money. Every group keeps its money in its own
external bank account — see [docs/product-brief.md](docs/product-brief.md).

This is Phase 1: the product and technical foundation. See
[docs/mvp-roadmap.md](docs/mvp-roadmap.md) for what comes next.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The public site,
authentication screens and onboarding flow all render without any
environment variables set. To exercise sign-up/sign-in and real group data,
copy `.env.example` to `.env.local` and fill in a Supabase project's
credentials (see [docs/architecture.md](docs/architecture.md)).

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

The initial schema and Row Level Security policies live in
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
Apply it to a Supabase project with the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```
