# pricing-offer

Publishes the configured monthly fee and percentage through `index.ts`.

## Owns

- `rules.ts`: resolves the same configured offer for every visitor without request state

## Does not own

Environment parsing belongs to pricing-flags; subscription snapshots belong to shop-subscriptions.

## Invariants

The public offer uses the same configured terms as billing. Visitor cookies and headers never select pricing.
