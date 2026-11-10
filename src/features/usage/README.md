# usage

This module owns the usage use case and publishes its contract through `index.ts`.

## Owns

- `index.ts`: domain rules and use-case helpers.
- `collect.ts`: domain rules and use-case helpers.
- `anthropic.ts`: domain rules and use-case helpers.
- `neon.ts`: org totals and identity-preserving project consumption observations.
- `neon-quota.ts`: alert-only quota diagnostics against explicit recent account evidence.
- `vercel.ts`: domain rules and use-case helpers.
- `probe.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

## Evidence boundaries

Org budgets are not project quotas. Project diagnostics require a matching reset period and
recent, explicit plan/allowance evidence; missing or ambiguous evidence remains unknown.
GiB-months cannot substitute for a current storage-size observation. The cost report accepts
local evidence via `--quota-evidence`; it does not configure a recurring quota monitor or
verify account assertions itself. No provider account or plan is changed.
