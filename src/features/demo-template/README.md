# demo-template

Mints a visitor's one-click demo shop by copying a shop this process already built
(ADR 20261120-demo-mint-replays-a-template), instead of running the whole seed again.

## Owns

- `store.ts`: `mintDemoShop`, the capture of what a shop owns, and its write-back under new ids.

## Does not own

The seed (`src/db/seed.ts`), the e2e reset's copy of the canonical shop
(`src/features/demo-reset-snapshot`), and every other way of minting a shop: a private test shop, a
pinned slug and a lean schedule still call `createDemoShop` directly.

## Invariants

A copy serves one shop-local day. A capture that cannot prove itself is refused and logged, and
that day's mints build for real. Nothing here names a table.
