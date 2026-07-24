# 20260724-trigram-search-indexes — pg_trgm GIN indexes back the leading-wildcard staff search

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

[The 2026-07-23 codebase review](../../product/assessments/codebase-review-20260723.md) (CR-018)
found that the command palette (`src/db/search.ts`) and diver roster/booking picker
(`src/db/divers.ts`) both search with a leading-wildcard `ilike '%query%'`, while their own
comments claimed the columns were "indexed `ilike`." No such index existed — a plain btree index
cannot serve a leading-wildcard predicate, so every one of those searches was a full scan of
`people`, `trips`, and `dive_sites`. Result limits (`PER_GROUP = 8`) cap what comes *back*, not how
much the database has to scan to find it.

## Decision

- **Trigram GIN indexes (`pg_trgm`), not a normalized-prefix strategy.** A prefix index (e.g. a
  btree on `lower(full_name)` matched with `LIKE 'query%'`) is cheaper to build and needs no
  extension, but it only serves prefix queries — it would silently change what staff can find
  (searching "sharma" for "Priya Sharma" would stop working) unless the product also changed to
  prefix-only search, which is a UX regression this ticket has no mandate to make. `pg_trgm`'s GIN
  similarity index serves the exact `ilike '%query%'` pattern already in use, so the fix closes the
  performance gap without changing search behavior.
- **Indexed columns:** `people.full_name`, `people.email`, `people.phone`, `trips.title`,
  `dive_sites.name` — exactly the columns `search.ts`/`divers.ts` already query, one
  `CREATE INDEX ... USING gin (<col> gin_trgm_ops)` per column
  (`drizzle/20260724001031_trigram-search-indexes`).
- **`pg_trgm` is a standard Postgres contrib extension** (`CREATE EXTENSION IF NOT EXISTS pg_trgm`
  at the top of the migration) — available on Neon with no plan/tier requirement, so this adds no
  new vendor or service, only a first-party extension already bundled with Postgres.
- **PGlite needs the extension passed explicitly at client construction** (`extensions: { pg_trgm }`
  in `src/db/client.ts`), unlike real Postgres where the migration's `CREATE EXTENSION` alone is
  enough — PGlite's wasm build only loads a contrib module when the JS caller asks for it. The same
  fix was needed in the two other places this repo constructs a PGlite client directly:
  `src/test/db-template.ts` (builds the shared test-template snapshot) and `src/test/db.ts`
  (restores a per-test clone from that snapshot's dumped data directory) — a data directory dump
  carries the `pg_extension` catalog row and the index definitions, but a client restored from it
  still needs the extension registered on the JS instance to execute trigram operators at query
  time, or every insert into an indexed column fails with `could not access file "pg_trgm"`.

## Alternatives considered

- **Normalized-prefix index** — rejected as a silent product behavior change (substring → prefix
  search), see Decision above.
- **A full-text-search (`tsvector`) index** — solves a different problem (token/word matching,
  ranking) than the substring "does this appear anywhere in the name/email/phone" search staff
  actually rely on for partial names and phone-number fragments; out of scope for a bounded
  indexing fix.

## Consequences

- Neon (production) query plans for these searches should move from a sequential scan to a bitmap
  index scan as the seeded dataset grows past the planner's small-table threshold; this repo has no
  standing connection to a production/staging Neon database to capture a real before/after
  `EXPLAIN`, so that capture is deferred to whoever next operates against a populated Neon database
  — `src/db/search.test.ts` instead asserts structurally (via `pg_indexes`/`pg_extension`) that the
  indexes and extension exist, which PGlite can verify today.
- Every future PGlite-backed test database (via `createTestDb`, the shared test-template builder, or
  its per-test restore) must keep passing `extensions: { pg_trgm }` at construction — a call site
  that reintroduces a bare `new PGlite(...)` without it will fail the first insert into an indexed
  column, not at migration time.
