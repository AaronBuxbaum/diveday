# courses

This module owns the courses use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.
- `doors.ts`: the first shop-catalog match for trying diving, entry certification, and a refresher.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.
