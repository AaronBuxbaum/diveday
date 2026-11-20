# 20261120-e2e-purge-settles-by-set — Delete the e2e reset's minted demos with their key checks settled by set

- **Status:** Accepted
- **Date:** 2026-11-20
- **Amends:** [20261024-e2e-reset-replays-a-snapshot](20261024-e2e-reset-replays-a-snapshot.md)
  (the purge half of the same reset, not the replay)

## Context

Every Playwright test's `POST /api/test/reset` also deletes the demo shops earlier tests minted
through "Try the live demo". Deleting one full demo (~150 people, ~650 bookings) checked every
deleted row against each of the ~50 tables naming it, mostly through unindexed columns: 1.8s on an
idle PGlite and 3.6s in CI run 44358077971, inside a 15s test budget (#4763). Indexing those
columns was rejected for the same reason the replay rejected it.

## Decision

- `purgeMintedDemoShopsWithoutTriggers` (`src/features/demo-reset-snapshot/store.ts`) runs the
  unchanged `deleteDemoShopCascade` for each minted shop with foreign-key triggers off
  (`session_replication_role = replica`, inside a savepoint), then one PL/pgSQL settle in the
  `e2e_purge` schema applies cascades and `SET NULL` keys by set and refuses any other key left
  pointing at nothing, as the replay's clear half already does.
- A refusal, or a delete trigger of a table's own that replica mode would skip, rolls the
  savepoint back and deletes that shop again with its triggers on, which raises the real 23503
  when there is one. The cascade's own guards (an encountered sighting, a private photo still
  owed) run unchanged and are not retried.
- The vacuum after a purge names the tables the purge deleted from; a purge that fell back
  vacuums the whole database.
- E2e only. The reaper, the mint's cap and the test-shop door keep the triggered cascade.

## Alternatives considered

- **Eight indexes on waiver and roll-call person columns**: saved 0.12–0.3s and moves production
  query plans.
- **Deferring the purge until after the response**: the next mint would wait on it on the same
  single PGlite connection.

## Consequences

- The purge costs 0.17–0.35s on an idle PGlite instead of 1.8s.
- A table missing from `deleteDemoShopCascade` still fails loudly, as a 23503 from the triggered
  retry.
- `store.test.ts` holds a purge to leave the database exactly as it was before the mint, and each
  key action and the trigger refusal to the triggered cascade's.
