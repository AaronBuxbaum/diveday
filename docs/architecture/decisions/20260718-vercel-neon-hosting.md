# 20260718-vercel-neon-hosting — Use Neon as the production Postgres provider, node-postgres driver

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

[20260718-vercel-hosting](20260718-vercel-hosting.md) selected Vercel as the web host but
deliberately left the managed Postgres provider unchosen, tracked as
[H-04](../../product/human-decisions.md) in the human decision log ("this ADR deliberately does
not choose a database vendor or store secrets"). [ADR-0005](0005-database.md) separately deferred
only the production driver, anticipating `drizzle-orm/node-postgres` "when hosting lands."

The product owner has now made the H-04 call directly: added Neon through Vercel's native
Marketplace integration, which provisions a Neon Postgres project and injects connection env vars
(`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, etc.) into the Vercel deployment. This record is the
implementation half of H-04 — the provider choice and connection plumbing — not a re-decision of
hosting itself.

## Decision

- **Neon** is the production Postgres provider, connected via Vercel's native integration.
  Preview deployments get their own branch database by default (see Consequences).
- **Runtime driver:** `drizzle-orm/node-postgres` (`pg`) against `DATABASE_URL` (Neon's pooled,
  PgBouncer connection string) — real session-based transactions, matching
  `src/db/bookings.ts`'s multi-step capacity-enforcement transaction, which the HTTP-batch
  `neon-http` driver cannot express (no branching on an intermediate query result mid-transaction).
  `src/db/client.ts`'s `getDb()` picks this branch whenever `DATABASE_URL` is set; both adapters
  bootstrap the required seeded demo shop, while PGlite (auto-migrated) remains the fallback when
  it isn't, so dev/test/CI are unaffected.
- **Migrations run during Vercel's production build, never on the request path or at cold
  start.** `vercel.json` invokes `scripts/vercel-build.mjs`; when Vercel's `VERCEL_ENV` is
  `production`, it runs `pnpm db:migrate` before `pnpm build`. The command (`drizzle-kit migrate
  --config drizzle.config.prod.ts`) applies committed `drizzle/` SQL against
  `DATABASE_URL_UNPOOLED` (Neon's direct connection — DDL over a transaction-mode pooler is
  unreliable), falling back to `DATABASE_URL`. **Enable Vercel's System Environment Variables**
  for the project so `VERCEL_ENV` is available. Preview builds intentionally skip migrations.
- `next.config.ts` adds `pg` to `serverExternalPackages` alongside `@electric-sql/pglite`, so the
  bundler leaves it external instead of trying to resolve its optional native/cloud drivers.
- `AUTH_SECRET` is **not** provided by the Neon integration — it's a separate Vercel project
  environment variable required for `next-auth` in production (see
  [ADR-0006](0006-auth.md)); `.env.example` documents it alongside the DB vars.
- H-04's remaining scope — named database/secrets/backup/incident owner — is still open; this ADR
  resolves the technical half (provider, driver, migration procedure), not the ownership half.
- No other new services are needed for M1: object storage, email, and payments stay deferred
  (`overview.md`'s deferred-decisions table, `product/roadmap.md`).

## Alternatives considered

- **`drizzle-orm/neon-http`** (`@neondatabase/serverless`, fetch-based) — fastest cold start, but
  its `.transaction()` sends a fixed batch of queries upfront and can't branch on results read
  mid-transaction; incompatible with the booking capacity check as written.
- **`drizzle-orm/neon-serverless`** (`@neondatabase/serverless` `Pool`, WebSocket) — real
  transactions like node-postgres, but needs a `ws` polyfill outside edge/browser and buys nothing
  over plain `pg` since this app runs no edge routes today.
- **Wait for a named H-04 owner before wiring code** — the standing default per
  [20260718-vercel-hosting](20260718-vercel-hosting.md); superseded here because the product owner
  made the provider call directly by adding the integration, which is itself the H-04 outcome for
  the provider question.
- **Run migrations for every Vercel build** — rejected because preview deployments build
  concurrently and should not mutate their databases. The build script gates the command on
  Vercel's production environment instead.

## Consequences

- Production and dev/test now genuinely diverge in driver, isolated to the `getDb()` seam in
  `src/db/client.ts` as designed.
- A production deployment applies committed migrations before its app build. Migrations must be
  backward-compatible with the currently deployed application: a successful migration is not
  rolled back if the subsequent app build fails.
- Vercel's Neon integration provisions a **branch database per preview deployment** by default;
  preview branches start as a copy-on-write fork of the production branch and do not receive
  migrations automatically. Apply preview-only migrations deliberately if a preview needs to
  exercise a new schema.
- H-04 still needs a named owner for backups, secrets rotation, and incident response before this
  is production-ready for real customer data — update the human decision log when that's assigned.
- Escape hatch: if connection-count pressure or edge-runtime needs show up later, revisit toward
  `neon-serverless`; the `getDb()` seam and this ADR's alternatives section are the starting point.
