# FU-20260814-guard-promise-all-on-a-transaction — Make `Promise.all` on a `DbExecutor` a check, not a comment

- **Status:** Open
- **Raised:** 2026-08-14 — fixing the `pg` deprecation warning seen on `POST /shop/*/check-in`
- **Kind:** improvement
- **Effort:** M
- **Touches:** `scripts/check-repo.mjs`, `src/db/client.ts`, `src/db/readiness.ts`, `src/db/bookings.ts`, `src/db/trips-series.ts`

## What I noticed

A drizzle transaction is one checked-out `pg` client, so `Promise.all` over queries on a `tx` is not
parallel — `pg` queues them and warns that it will stop accepting them in pg@9:

```
DeprecationWarning: Calling client.query() when the client is already executing a query is
deprecated and will be removed in pg@9.
```

This has now been found in production **twice**. Issue #517 fixed it in
`src/db/trips-schedule.ts` (which left a comment saying exactly this), and it reappeared on
2026-08-14 in the counter check-in: `checkInBooking` → `getBookingReadiness(tx)` →
`listTripReadiness(tx)`, whose six-query `Promise.all` was written for the pool. This change added
`queryAll` (`src/db/client.ts`) and applied it to the four reachable sites — `src/db/readiness.ts`
(three), `src/db/bookings.ts` (two), `src/db/trips-series.ts` (one).

Finding those four took a manual sweep: list every function called with a `tx`, then look inside
each for a `Promise.all`. That sweep is only correct for today's call graph. The next reader who
adds a `Promise.all` to a `DbExecutor`-taking function — or, worse, calls an existing pool-only
reader from inside a new transaction — reintroduces it, and nothing fails. The symptom is a
deprecation warning in a log nobody is reading, until pg@9 turns it into an error on a booking or a
check-in.

## Why it isn't already done

Writing the check well is more than a grep, and I did not want to bolt a noisy one onto
`pnpm check:repo` in a bug-fix change. The naive rule ("no `Promise.all` in `src/db`") is wrong —
plenty of those functions only ever see the pool, where the fan-out is real and worth having. The
rule that matches the actual hazard is "a function whose executor parameter is typed `DbExecutor`
(or is named `tx`) may not call `Promise.all` on queries against it", and that wants a small amount
of AST work rather than a regex, plus a decision about the escape hatch for a `Promise.all` that
genuinely isn't over queries.

## Proposed change

A `scripts/check-db-concurrency.mjs` in the `pnpm check:repo` set, in the shape of its siblings
(`check-clock.mjs` is the closest analogue — same "this call is banned in this layer" idea):

- Walk `src/db/**` and `src/features/**`. For any function with a parameter typed `DbExecutor` or
  `AppTransaction`, refuse a `Promise.all` / `Promise.allSettled` in its body.
- Allow an opt-out on the line, matching the repo's existing convention:
  `diveday:allow-db-concurrency: <why>` — for a `Promise.all` that is not over queries on that
  executor at all (`src/db/import.ts`'s bounded fetch pool is the real example).
- Point the failure message at `queryAll` rather than at "make it sequential": the whole reason
  `queryAll` exists is that a reader shared between a page render and a transaction should not have
  to choose, and telling someone to serialize a hot roster read would be a real regression.

I am *not* proposing that `queryAll` become mandatory everywhere in `src/db`. A function that only
ever takes `AppDb` is on the pool by construction and its `Promise.all` is correct as written.

## Prompt

```text
Add a repository safeguard that refuses concurrent queries on a database transaction, so the pg
deprecation warning fixed twice already (issue #517, then 2026-08-14 on the counter check-in)
cannot come back a third time.

Read first: src/db/client.ts (the `queryAll` helper and its comment — this is the fix the check
should point people at), src/db/trips-schedule.ts around the "Sequential, not Promise.all" comment,
and scripts/check-clock.mjs plus its wiring in scripts/check-repo.mjs (the closest existing
"this call is banned in this layer" check, and the shape to copy).

The constraint that makes this non-obvious: `Promise.all` in src/db is NOT wrong in general. A
function that only ever receives `AppDb` runs on the pool, where the fan-out is real and removing it
would slow down hot roster/manifest/Today renders. The hazard is only a function that can receive a
transaction — one checked-out client — which in this codebase means a parameter typed `DbExecutor`
or `AppTransaction`. Scope the rule to that.

Done is: `scripts/check-db-concurrency.mjs` exists, runs inside `pnpm check:repo`, passes on the
tree as it stands today, and fails on a deliberately introduced `Promise.all` in a
`DbExecutor`-taking function. It supports a line-level `diveday:allow-db-concurrency: <why>` escape
hatch (src/db/import.ts's bounded fetch pool is the case that needs it), and its failure message
names `queryAll` as the fix rather than telling the reader to serialize. Add its one-line entry to
the `pnpm check:repo` row in AGENTS.md.

Run `pnpm check`. Delete docs/product/follow-ups/FU-20260814-guard-promise-all-on-a-transaction.md
as part of the change.
```
