# payments

This module owns the payments use case and publishes its contract through `index.ts`.

## Owns

- `index.ts`: domain rules and use-case helpers.
- `customer-address-form.ts`: domain rules and use-case helpers.
- `refund-failure-reason.ts`: domain rules and use-case helpers.
- `webhook.ts`: domain rules and use-case helpers.
- `payout-summary.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.
