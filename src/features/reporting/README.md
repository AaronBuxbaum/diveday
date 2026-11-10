# reporting

This module owns the reporting use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.
- `rules.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

Monthly report aggregates use independent query waves of at most four on a pool and remain serial
on a pinned transaction. The SQL scopes and financial arithmetic are shared with the original
report; this scheduling change claims no measured production latency improvement.
