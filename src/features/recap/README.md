# recap

This module owns the recap use case and publishes its contract through `index.ts`.

## Owns

- `recap-cached.store.ts`: scoped readers and recorded transitions.
- `recap-pulses.store.ts`: scoped readers and recorded transitions.
- `store.ts`: scoped readers and recorded transitions.
- `recap-assist.store.ts`: scoped readers and recorded transitions.
- `recap-schedule.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.
