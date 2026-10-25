# 20261024-e2e-reset-replays-a-snapshot — The e2e reset replays the seeded schedule from a copy

- **Status:** Accepted
- **Date:** 2026-10-24
- **Amends:** [20260815-per-test-private-shops](20260815-per-test-private-shops.md) (how the
  per-test reset is served, not what it restores)

## Context

Every Playwright test starts with `POST /api/test/reset`, which ran `resetDemoSchedule`: about 110
child-first deletes and a re-seed of ~4,400 rows, 1.2s a test on an idle CI runner and 3.7s on a
loaded local box. Most of it was the re-seed's statements and the foreign-key triggers on the
deletes, which check each deleted row against every referencing table, mostly through unindexed
columns. The measurements are in the pull request that made this change.

## Decision

- **The first reset on an e2e server is real, and copies what it wrote.** `resetDemoSchedule` is
  split into `clearDemoSchedule` (deletes only) and the re-seed. The first call runs both, then in
  one transaction copies every table, runs the clear half, and keeps the rows that went (and the kept
  columns the re-seed changed) in the `e2e_shadow` schema. Nothing names a table: what a reset owns
  is found by difference.
- **The capture proves itself**: it replays its copy and compares every table row for row with the
  real reset's result; a difference rolls it back and the server resets the slow way.
- **Every later reset replays**: the clear half, then one `INSERT … SELECT` per table, in one
  transaction, through PL/pgSQL functions whose plans the server keeps.
- **Foreign-key triggers are off for the replay** (`session_replication_role = replica`,
  transaction-local) and their work is done by set: cascades and `SET NULL` applied over the rows
  they would have reached, any other key left pointing at nothing refusing the replay as its 23503
  would have, and every kept row the copy names checked after the inserts. A refused replay rolls
  back whole and the reset runs for real.
- **A copy serves only the shop and the frozen instant it was taken at.**
- **E2e only.** The route keeps both guards (`e2eTestRouteAuthorized`, which refuses whenever a
  `DATABASE_URL` is set); the in-app "reset demo shop" action still runs `resetDemoSchedule`.

## Alternatives considered

- **Reloading a PGlite dump of the whole database**: slower (1.2s), and it would put back what
  `RESET_KEEPS` says a reset keeps.
- **A lean reset (`history: false`) for specs that read no history**: still 1.5s.
- **Indexing every foreign-key column in the e2e database**: it moves query plans, and the order of
  unordered reads, away from production's.

## Consequences

- A replay puts rows back under the same ids every time; a kept row naming a reset-owned id (an
  integration sync record, say) now names a row that exists again. Specs writing such tables
  already take `privateShop`.
- The re-seed's `created_at` stamps no longer drift by a few hundred milliseconds per reset.
- `delete-path-coverage.test.ts` holds the copy to the delete list; `demo-reset-snapshot.test.ts`
  holds a replay to a fresh real reset, row for row, and each key action to its trigger's.
