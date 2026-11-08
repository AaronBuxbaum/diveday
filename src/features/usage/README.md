# usage

This module owns the usage use case and publishes its contract through `index.ts`.

## Owns

- `index.ts`: domain rules and use-case helpers.
- `collect.ts`: domain rules and use-case helpers.
- `anthropic.ts`: domain rules and use-case helpers.
- `neon.ts`: domain rules and use-case helpers.
- `vercel.ts`: domain rules and use-case helpers.
- `probe.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.
