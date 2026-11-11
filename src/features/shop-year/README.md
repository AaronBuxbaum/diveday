# shop-year

This module owns the shop year use case and publishes its contract through `index.ts`.

## Owns

- `rules.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

The display strip spans `startsOn` through `endsOn`, including empty and future days. Arithmetic remains bounded to the observed activity window; blank calendar context does not enter averages or comparisons.
