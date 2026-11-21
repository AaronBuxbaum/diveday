# 20261121-one-baseline-migration — Wipe production and start from one baseline migration

- **Status:** Accepted
- **Date:** 2026-11-21
- **Decided by:** Aaron, issue #4853 and his note of 2026-11-21 ("I'd kind of rather just clear
  everything out anyway; note that we have no users and no relevant data")
- **Builds on:** 20260904-squash-migration-baseline, whose name-reuse mechanism this drops

## Context

`drizzle/` had grown back to 382 migrations (7.6 MB) since the first squash, all replayed by
every fresh database. There are no users and production holds only demo data, so the history has
nothing to carry.

The pinned migrator (`drizzle-orm` 1.0.0-rc.5, which `drizzle-kit migrate` also calls) decides
what to run by folder **name** against `drizzle.__drizzle_migrations`, never by hash.

## Decision

Production's database is wiped (issue #4858) and `drizzle/` holds one migration,
**`20261121075816_baseline`**: `pnpm db:generate` output for `src/db/schema/`, plus the statements
the schema cannot express, carried by hand: the `pg_trgm` and `btree_gist` extensions, four
`und-x-icu` column collations, the `gear_reservations_no_overlap` exclusion constraint, and the
`booking_capabilities` identity trigger and its function.

Its folder name is new on purpose. A database that still carries the old history has never
applied that name, so it runs the baseline and stops on "already exists" before changing anything.
`src/db/migrations.postgres.test.ts` asserts that refusal whenever the baseline is new to the
previous release, and otherwise keeps checking that the previous release plus today's migrations
lands on the fresh schema.

With the history gone, so is what only the history needed: the `people.self_registered_at` column
kept for a release that no longer serves, and the destructive-migration guard's watermark, which
now names the baseline. Tests whose only subject was a deleted migration's backfill are deleted.

Proof (full catalog compared on PGlite and Postgres 16; details in the PR): a fresh database from
the baseline matches the schema `src/db/schema/` declares, and `pnpm db:generate` finds nothing to
add.

## Alternatives considered

- **Reuse the first migration's folder name, as the first squash did, plus a convergence
  migration** — keeps production's demo data, which nobody needs, at the price of a database that
  stopped part-way through the old history silently skipping the baseline.
- **Use the migrator's `init` mode** — it refuses a database that already has a ledger.

## Consequences

- A fresh database applies one migration. Parallel branches add folders after it;
  `pnpm db:merge` and the graph check are unchanged.
- Any database built before 2026-11-21 (production before #4858, an old dump, a local `.pglite`)
  is wiped, not upgraded: `pnpm db:reset` locally.
- Old migration ids survive in comments as provenance and no longer resolve to folders.
- Revisit when real divers arrive: from then on a squash cannot wipe, and has to prove an upgraded
  copy of production matches a fresh database instead.
