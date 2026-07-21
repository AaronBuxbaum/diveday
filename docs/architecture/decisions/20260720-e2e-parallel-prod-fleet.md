# 20260720-e2e-parallel-prod-fleet — Run e2e in parallel against a precompiled per-worker server fleet

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

[20260719-msw-offline-sync-only](20260719-msw-offline-sync-only.md) fixed cross-spec state bleed by
resetting the demo shop before every test, but left two costs in place and named the second as
future work:

- **Dev-server compile latency.** The suite ran `next dev`, so Turbopack compiled each route on its
  first hit. A cold server-action or page compile can take longer than an assertion's timeout, so
  the cert / nitrox / course / dive-site flows timed out intermittently (`nitrox.spec.ts` already
  carried `test.slow()` for exactly this reason). The failures were latency, not logic.
- **Serial execution.** That ADR's Consequences: *"True parallel e2e execution (`fullyParallel`,
  `workers > 1`) still isn't safe — all specs share one dev-server process and one database... the
  fix would be per-worker servers/databases, not a small change."* This is that change.

`getDb()` memoizes one connection per process, so one server means one database means serial specs.
Parallelism therefore requires one server **process** per worker, each with its own database.

## Decision

Serve a **production build** from **one `next start` server per Playwright worker**, each with its
own in-memory PGlite database.

- **Precompiled routes.** `pnpm e2e` runs `next build` first (`e2e:build`), then Playwright starts
  the servers. Production routes are already compiled, so no assertion races a first-hit Turbopack
  build. Iterating on a single spec, `playwright test <spec>` reuses the build on disk.
- **Per-worker isolation.** `e2e/servers.ts` is the shared topology (worker count defaults to half
  the cores — each worker is a browser *and* a server; ports; base URLs). `playwright.config.ts`
  maps it to one `next start` server per worker (`PGLITE_DATA_DIR=memory`, so each process seeds its
  own database). `e2e/fixtures.ts` points each worker's page/request fixtures at its own server via
  `parallelIndex`. With isolated databases, `fullyParallel` is safe and the per-test
  `POST /api/test/reset` only ever touches the worker's own data.
- **Production-runtime settings.** `next start` runs as `NODE_ENV=production`, which (unlike dev)
  demands an explicit `AUTH_SECRET` and rejects the loopback host without `AUTH_TRUST_HOST`; the
  config supplies test values for both.
- **Reset route opt-in.** `POST /api/test/reset` previously 404'd whenever `NODE_ENV === "production"`.
  Because the fleet *is* a production runtime, the guard now allows it under an explicit `DIVEDAY_E2E`
  opt-in **and** still 404s whenever `DATABASE_URL` is set. A real deployment always has a database
  URL and never sets `DIVEDAY_E2E`, so the route stays unreachable in production by two independent
  guards.
- **Warmup.** `e2e/global-setup.ts` resets each server's database and GETs the two routes every
  test hits first (`/` and `/sign-in`), so the first test doesn't absorb their one-time render
  cost. The worker count budgets ~2 cores per worker (each runs a browser *and* a server), so a
  typical 4-core runner uses a single uncontended worker and larger machines scale out.

## Alternatives considered

- **Parallel `next dev` servers.** Avoids the build step but keeps first-hit compile latency (now
  paid N times) and forces per-server `distDir` isolation to stop concurrent dev servers corrupting
  a shared `.next`. Precompiling once and serving read-only is simpler and removes the latency
  outright.
- **Raise timeouts / add `test.slow()` everywhere.** Hides the compile-latency flakiness behind
  longer waits instead of removing it, and does nothing for wall-clock — the same trade the prior
  ADR already rejected for state bleed.
- **Keep one server, shard across processes (`--shard`).** Parallelises across machines but not
  within one, and still pays dev compile per shard.

## Consequences

- E2e no longer races route compilation, and specs run `workers > 1` in parallel — the wall-clock
  win the prior ADR deferred. Warm assertions settle in well under a second; the widened
  `expect`/test ceilings are headroom for a cold dynamic-`[id]` render the warmup can't reach, not
  added latency.
- `pnpm e2e` now pays a one-time `next build`. Single-spec iteration skips it by calling
  `playwright test` directly against the existing build.
- The reset route is reachable in a production *runtime* when `DIVEDAY_E2E=1` and no `DATABASE_URL` is
  set. The `DATABASE_URL` guard remains the hard production protection; a future change must keep it.
- `resetDemoSchedule` (`src/db/seed.ts`) must still cover every mutable demo-schedule table or
  isolation silently breaks — this change also closed the `orders` / `order_line_items` gap that
  slipped through (regression in `src/db/seed.test.ts`).
- Reusing an authenticated session across specs to skip the repeated UI sign-in (a `storageState`
  per worker) is a further speedup left for later; specs still sign in through the UI.
