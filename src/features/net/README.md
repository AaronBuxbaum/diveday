# net

This module owns the net use case and publishes its contract through `index.ts`.

## Owns

- `public-fetch.ts`: domain rules and use-case helpers.
- `public-address.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.
