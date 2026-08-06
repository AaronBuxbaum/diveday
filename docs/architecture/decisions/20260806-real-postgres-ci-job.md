# 20260806-real-postgres-ci-job — Rehearse migrations and lock contention on a real Postgres in CI

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

Two facts about this repo's test strategy were true together, and their intersection was a hole
nothing could see into.

**Migrations had never met a real server before production did.** `scripts/vercel-build.mjs` runs
`pnpm db:migrate` inside the Vercel production build. Preview deploys skip migrations entirely, so
there is no rehearsal surface, and CI had no `services:` block — the unit suite runs on PGlite. The
production deploy was therefore the first execution of any committed `drizzle/` SQL against genuine
Postgres, on a pipeline with no down migrations and no staging environment
(ADR 20260718-vercel-neon-hosting; docs/engineering/deploy-and-migrations-runbook.md). PGlite is
close to Postgres, not identical: `CREATE EXTENSION pg_trgm` is a real statement in `drizzle/`, but
PGlite satisfies it out-of-band with a wasm extension loaded in JavaScript before any migration runs,
so Postgres-invalid SQL could sit in `drizzle/` with a fully green suite.

**PGlite is single-connection, so no `FOR UPDATE` had ever been contended.** Two transactions cannot
occupy the same critical section on one connection. The oversell guard in `createBookingRecord` and
the serialization in `withBookingPaymentLock` (CR-004) were therefore structurally unexercisable —
both could be deleted and every test would still pass. `src/db/money-replay.test.ts` already recorded
this limitation from the money side; it was a known gap with no mechanism behind it.

The residue ticket OPS-2 / P1-3 asked for a real-Postgres CI job covering both.

## Decision

Add a `real-postgres` job to `.github/workflows/ci.yml` running a `postgres:16` service container,
plus an opt-in harness and three suites.

**The switch is `DIVEDAY_TEST_POSTGRES_URL`, deliberately not `DATABASE_URL`.** `DATABASE_URL` is
what `getDb()` reads, and both `vitest.config.ts` and `src/test/global-setup.ts` pin it to `""`
precisely so no test can reach a real database by accident. Reusing it would un-pin that for the
whole run and point every unrelated test at whatever server CI had up. One purpose-built variable
keeps the blast radius to the files that ask for it by name. Unset — every local `pnpm test`, every
one of CI's four unit shards — `describePostgres` registers a skipped suite: no connection attempted,
no service required.

**Each test gets its own scratch database**, created and dropped by `postgresTestDb()`
(`src/test/postgres.ts`), so these stay as isolated as their PGlite siblings while sharing a server,
and a race test can open several real connections onto the same rows.

**Three proofs**, in `src/db/migrations.postgres.test.ts`, `bookings.postgres.test.ts`, and
`payments.postgres.test.ts`: migrations apply from empty; they apply on top of the previous release's
schema (reconstructed from `git merge-base origin/main HEAD` by
`scripts/previous-release-migrations.mjs`, streamed out of the object store so no ref moves and no
working tree is disturbed) and both paths land on an identical catalog fingerprint; and the two locks
hold under genuine contention.

**Gated two ways: on `src/db/**` / `drizzle/**` / harness changes, and nightly.** The path gate is a
`db-surface-changes` job doing a `git diff`, not a workflow-level `paths:` filter — that filter
applies to the entire workflow, so putting one on the `pull_request` trigger would stop lint,
typecheck, and every test shard from running on any PR that happens not to touch `src/db/`. It fails
**open**: any path that cannot resolve a base commit answers "changed", because a false positive
costs two runner-minutes and a false negative costs an unrehearsed migration. The nightly exists
because this job's value decays with time rather than with the diff — what invalidates the proof
arrives from another branch, or from a base image moving.

**Every pre-existing job carries `if: github.event_name != 'schedule'`.** A workflow-level
`schedule:` trigger fires *every* job in the file. Without these guards the nightly would run the
build and twelve Playwright/visual shards for no signal, and `visual-report` would republish main's
S3 snapshot on a run that resolved no baseline — the "compared nothing, reported everything as new"
failure that job's own comments exist to prevent. `visual-report` needs a compound condition rather
than the plain guard, because its deliberate `!cancelled()` is true for a *skipped* dependency as
much as a failed one.

## Alternatives considered

- **A separate workflow file.** Avoids touching `ci.yml` at all and needs no per-job guards. Rejected
  to keep one place to read what CI does; the guards are explicit and commented where they sit.
- **Workflow-level `paths:` filter.** Would have silently gated lint, typecheck, and every test shard
  on the same paths. Rejected as actively dangerous.
- **A third-party filter action (`dorny/paths-filter`).** Rejected: the comparison is a few lines of
  shell, and that is preferable to a new supply-chain dependency in every CI run.
- **Testcontainers, or booting Postgres in the test process.** Rejected: GitHub's `services:` block
  already does exactly this, declaratively, with a health check and no new dependency.
- **Reusing `DATABASE_URL`.** Rejected for the isolation reason above — it is the one variable the
  repo works hardest to keep empty in tests.
- **Running these suites on every PR.** Rejected as waste on the ~90% of PRs touching no schema; the
  nightly covers the decay the path gate misses.
- **Doing nothing and keeping the runbook's warning.** The warning was accurate and had been accurate
  for a long time, which is the argument against leaving it as the only mitigation.

## Consequences

- **The deploy is no longer the first real execution of a migration** — but rehearsal is against an
  empty database, so anything that scales with row count (lock duration, backfill runtime, a
  `NOT NULL` real rows violate) is still discovered in production. The runbook says so explicitly;
  this narrows the gap and must not be read as closing it.
- **Two guards are now load-bearing in CI.** Deleting `.for("update")` in `createBookingRecord` sells
  2 seats on a one-seat trip and 5 on a two-seat trip; deleting it in `withBookingPaymentLock` forks
  the `booking_payment_events` chain. Both measured, both now red.
- **A subtlety future readers must not get backwards.** `waitForLockWaiters` establishes
  *simultaneity*, not the guard: a contender blocks on the gate regardless, because its `INSERT`
  takes a `KEY SHARE` lock during the foreign-key check, which already conflicts with the gate's
  `FOR UPDATE`. The **outcome** assertions are what catch a missing lock. Each suite says this at the
  point of use so nobody "simplifies" the assertion that actually works.
- **A new job added to `ci.yml` joins the nightly unless it carries the guard.** This is the sharpest
  maintenance edge of the decision, and the reason it is recorded here rather than only in comments.
- **A race test may not sort by a column that does not order the writes.** Found the hard way: the
  payments suite originally ordered `booking_payment_events` by `id`, which is `defaultRandom()`, and
  passed about half the time. `occurred_at` is no better (frozen clock, identical for both) and
  `created_at` is transaction-*start* time, deliberately the same instant for contenders released
  from one gate. These suites assert invariants — follow `previous_status` to rebuild the chain, count
  seats — never row order.
- **A new `src/db/*.postgres.test.ts` suite is picked up automatically**, by glob rather than by a
  hand-maintained list. The first draft named its three suites explicitly for auditability; a fourth
  (`refunds.postgres.test.ts`, PAY-L3) was written against this harness in a parallel branch within
  hours, and an explicit list would have merged it while running it nowhere — these suites skip in
  the unit shards by design, so this job is their only home. A stale list fails silently, which is
  the failure mode the job exists to remove.
- **The container's major version should track Neon's.** A drift means migrations are rehearsed
  against a different engine than they deploy to — a quieter version of the gap this closes.
- **No new dependency.** `pg` (^8.22.0) and `drizzle-orm/node-postgres` are already production
  dependencies via `src/db/client.ts`; the harness adds no package.
