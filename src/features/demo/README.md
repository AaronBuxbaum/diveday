# demo

The demo shops a visitor or a test opens: minting one, resetting it, and keeping it quiet.

## Owns

- `demo-template.ts`: mints a visitor's one-click demo shop by copying a shop this process
  already built (ADR 20261120-demo-mint-replays-a-template).
- `demo-reset-snapshot.ts` (the e2e reset's copy of the canonical shop), `demo-preview/`,
  `demo-starts/`, `demo-seat.ts`, `quiet-demo-device.ts`.

## Does not own

The seed scenarios (the `@/db/seed` barrel) and every other way of minting a shop: a
private test shop, a pinned slug and a lean schedule still call `createDemoShop` directly.

## Invariants

- A template copy serves one shop-local day. A capture that cannot prove itself is refused and
  logged, and that day's mints build for real. `demo-template.ts` names no table.
