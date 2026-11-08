# storage

This module owns the storage use case and publishes its contract through `index.ts`.

## Owns

- `dive-site-photos.ts`: domain rules and use-case helpers.
- `ingest-url.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.
