# 20261120-demo-mint-replays-a-template — A visitor's demo is written from a copy

- **Status:** Accepted
- **Date:** 2026-11-20
- **Amends:** [20260724-per-visitor-demo-shops](20260724-per-visitor-demo-shops.md) (how a minted shop
  is written, not what it holds)

## Context

Each one-click demo built a whole shop: `createDemoShop`, about 1,350 statements, 2.7 to 3.2 s idle
and twice that under load; on a hosted database each statement is a round trip. The e2e demo specs
failed about five times in two days at their 8 s entry assertion (issue #4763, with measurements).

## Decision

- **The first mint in a process builds for real; the visitor does not wait for what follows.** After
  the response, `after()` reads back every row the shop owns (the closure of rows naming it through
  foreign keys, found in one PL/pgSQL block from the catalog), keeps them as JSON text in memory, and
  writes them back once in a savepoint it rolls back.
- **That write is the proof.** The database refuses a unique value the swap missed or a key left
  pointing at nothing, and the copy must own exactly as many rows, table by table, as the source. Any
  failure is logged (`demo_template.refused`) and that day's mints build for real, as before.
- **Every later mint that shop-local day writes the copy**: `enforceMintedDemoCap`, then one
  `INSERT … SELECT … FROM jsonb_populate_recordset` per table, parents first, foreign-key triggers
  on. Primary-key uuids the shop owns are replaced by value wherever they appear, the old slug and
  name by the new ones, numbered keys a foreign key names take new numbers from their sequence, and a
  unique column the swap leaves alone (a random token) takes a new random value of its shape.
- **One shop-local day**, since the seed's dates are relative to the day it ran.
- **Only the visitor's demo.** A private test shop, a pinned slug, a lean schedule and the in-app
  reset are unchanged. So are the offline manifest save and route prefetch.

## Alternatives considered

- **A dedicated CI lane for the demo specs**: moves the wait, not the cost, and the mint is just as
  slow for a real visitor.
- **A template shop kept in the tables, or a copy in a shadow schema** (as the e2e reset does): a
  row every cross-shop query and the reaper would have to exclude, or DDL the application role may
  not hold on a hosted database. JSON text held in memory needs neither and behaves the same on
  PGlite and on Postgres.
- **Delaying the offline manifest save or the first prefetches**: a change to a safety surface.

## Consequences

- A day's demos share their rows, but for ids, name, slug and tokens, not a fresh random draw.
- A new table, column or unique index needs nothing here; a unique value that is neither an id nor
  derived from the slug nor a token of a recognisable shape refuses the copy until it does.
- `src/db/catalog.ts` holds what the catalog says, shared with `demo-reset-snapshot`.
