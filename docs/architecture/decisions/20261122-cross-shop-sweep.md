# 20261122-cross-shop-sweep — Find cross-shop leaks with a runtime sweep, not row-level security

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

The worst bug here is one shop seeing another's divers, bookings, medical answers or money. Agents
write the code and nobody reads all of it, so hand-written tests on some functions and a text scan
of staff pages (`scripts/check-tenant-gates.mjs`) miss the function nobody tested. Aaron accepted
no database-level lock between shops for now ([guardrails.md](../../engineering/guardrails.md),
hole 6).

## Decision

`src/db/cross-shop.sweep.test.ts` builds two shops in one PGlite: A is the seeded demo shop with its
history, B is minted by `createDemoShop`. The fixture (`src/test/cross-shop/fixture.ts`) writes a
`LEAK-A-<n>` marker into A's names, notes and medical text and collects every uuid primary key of
A's rows (a `shop_id` of A's, or a foreign key reaching one). Discovery parses `src/db/*.ts` with
`oxc-parser` 0.152.0 (exact-pinned devDependency; it reads parameter names and the object types
they carry, through imports, which runtime source text cannot). Every exported function whose first
parameter is `db` or `tx` is one of: **swept** (takes a shop and every required parameter has a
name the fixture fills), **not shop-scoped by design** (named with a reason in
`src/test/cross-shop/not-shop-scoped.ts`, the surface a security reviewer reads), or **not fillable
yet** (a banked count in `scripts/cross-shop-coverage.json` that may only fall). Anything else fails.

Each swept function is called as B with A's ids, and as A, in a savepoint that is always rolled
back. A call fails when its answer, walked at any depth, holds one of A's keys or a marker (the ids
it was handed are excused), or when it changed A's rows (a per-table hash, taken only after a write).
A throw or an empty answer passes. Planted leaky and safe functions prove the oracle sees.

## Alternatives considered

- **Row-level security**: Postgres refuses the foreign row no matter what the query says. It needs
  a session variable on every connection and transaction, policies on every table, and a second
  role for jobs that walk every shop: a large change across every query, and the sweep finds most
  of what it would stop. Revisit before the first shop that is not a friend.
- **Reading parameter names from `Function.prototype.toString`**: transpiled output loses types,
  so an `input` object's fields are invisible.

## Consequences

A new database function that leaks is caught on the pull request that adds it, with no test written
for it, in under a minute. The sweep cannot see: a function whose parameters it cannot fill
(listed, banked), a function that takes no shop and trusts its caller to have checked an id (the
allowlist's last group), leaks in routes, server actions and features that do not go through
`src/db`, a count or flag computed over another shop's rows, and a join that returns a foreign value
the fixture neither marked nor keys. Each filled name gets one value of A's, so a branch reached
only by other data is not tried.
