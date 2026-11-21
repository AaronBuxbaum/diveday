# 20261121-one-baseline-migration — Collapse the migration history into one baseline again

- **Status:** Accepted
- **Date:** 2026-11-21
- **Decided by:** Aaron, issue #4853 (2026-11-21)
- **Builds on:** 20260904-squash-migration-baseline, whose name-reuse mechanism this repeats

## Context

`drizzle/` had grown back to 382 migrations (7.6 MB) since the first squash, all replayed by
every fresh database. There are still no users, so rewriting history is affordable; production
holds only demo data.

The pinned migrator (`drizzle-orm` 1.0.0-rc.5, which `drizzle-kit migrate` also calls) skips a
local folder whose **name** is already in `drizzle.__drizzle_migrations`, never comparing hashes.

## Decision

`drizzle/` is one baseline plus one convergence migration:

- **`20260721131359_cheerful_masque`**, the baseline: `pnpm db:generate` output for
  `src/db/schema/`, plus the statements the schema cannot express, carried by hand: the `pg_trgm`
  and `btree_gist` extensions, four `und-x-icu` column collations, the
  `gear_reservations_no_overlap` exclusion constraint, and the `booking_capabilities` identity
  trigger and its function. Its folder name is the first migration's, so a database built from the
  old history skips it. **Never rename it.**
- **`20261121063401_converge-squash-drift`**, which does nothing on a fresh database and, on one
  built from the old history, drops `shop_shore_alert_tokens` (no longer declared since #3721; its
  drop had been deferred a release) and renames the constraints the history left under old names
  (`buddy_pair_members_*`, `roll_call_events_status_not_null`).

Proof (full catalog compared on PGlite and Postgres 16; details in the PR): a database upgraded
from the 382 migrations equals a fresh one except for column *order* in 57 tables, which nothing
in the app or `pg_dump` depends on, and a seeded one kept every row.

Tests whose only subject was a deleted migration's backfill are deleted with it.

## Alternatives considered

- **Reset production and squash without convergence** — loses the demo data and Aaron's account
  for no gain; kept as the fallback in issue #4858.
- **Fold the convergence into the baseline** — a database that skips the baseline would never run
  it.
- **Use the migrator's `init` mode** — it refuses a database that already has a ledger, which is
  production.

## Consequences

- A fresh database applies two migrations. Parallel branches still add folders after the
  convergence; `pnpm db:merge` and the graph check are unchanged.
- **A database that stopped part-way through the old history is silently wrong** after this: it
  skips the baseline and misses the rest. Production's ledger is checked before merging (issue
  #4858); an older dump is first migrated with the last pre-squash commit (deploy runbook,
  "The baseline, and a database built before it"). A local `.pglite` is rebuilt with
  `pnpm db:reset`.
- Old migration ids survive in comments as provenance and no longer resolve to folders.
- Revisit when real divers arrive: from then on a squash needs this same proof against a copy of
  production, and the reset fallback is gone.
