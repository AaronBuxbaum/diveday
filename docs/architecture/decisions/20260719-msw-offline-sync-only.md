# 20260719-msw-offline-sync-only — Keep Playwright for flows; add MSW only for the offline-manifest-sync fetch boundary

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

The e2e suite (`e2e/*.spec.ts`, Playwright against a real dev server + PGlite) had drifted: every PR
ran it once via `pull_request` and again via `push` after merge (`.github/workflows/ci.yml`), each
run took ~25 minutes, and 15 of 29 tests were failing. The failures traced to shared state: all
specs run serially against one dev-server process and one `.pglite-e2e` database (necessarily, since
`getDb()` memoizes a single connection for the process's lifetime), so a booking made by one spec
file changed the seeded capacity counts another spec file asserted on, and retries (`retries: 2`)
multiplied the wall-clock cost of every such collision.

The initial ask was to replace this suite with MSW-mocked component tests. That doesn't fit this
codebase: nearly every page under `src/app/` is an `async function Page()` reading data directly
from the database (`src/db/queries.ts`) and mutating through inline `"use server"` closures, not a
client that fetches JSON from an API. Next's own bundled docs
(`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`) say plainly: *"Since async Server
Components are new to the React ecosystem, Vitest currently does not support them... we recommend
using E2E tests for async components."* Confirmed firsthand: these pages call request-scoped APIs
(`connection()` from `next/server`, `notFound()`/`redirect()` from `next/navigation`) that read from
Next's per-request `AsyncLocalStorage` and throw (`throwForMissingRequestStore`,
`node_modules/next/dist/server/request/connection.js`) when the page function is invoked outside a
real Next request — which is exactly what a Vitest/Testing-Library render would do. Reproducing that
context reliably means shimming Next internals Next explicitly doesn't support shimming.
`next-auth@5.0.0-beta.31` (paired with the `next@16.3.0-preview.6` preview) adds a second landmine:
importing `@/lib/auth` under Vitest fails to resolve `next/server` at all
(`ERR_MODULE_NOT_FOUND`, because `next`'s `package.json` has no `"exports"` map for a bare
`next/server` specifier and Next's own bundler — not plain Node/Vite resolution — is what normally
papers over that). MSW mocks `fetch`/XHR; it has nothing to intercept for this class of page either.

## Decision

Keep Playwright as the flow-coverage layer for the RSC + server-action surfaces (booking,
certifications, manifests, waivers, nitrox, gear, dive sites, courses, schedule) — that is what
Next's own guidance recommends for this shape of app. Fix the suite instead of replacing it:

- **Isolation**: `POST /api/test/reset` (`src/app/api/test/reset/route.ts`) re-runs
  `resetDemoSchedule` against the demo shop before every test (`e2e/fixtures.ts`, a `test.beforeEach`
  wired into every spec via a shared `test`/`expect` export). The route 404s whenever
  `NODE_ENV === "production"` or `DATABASE_URL` is set, so it cannot exist against a real database
  regardless of deploy configuration.
- **CI**: `.github/workflows/ci.yml` triggers on `pull_request` only — dropped `push: branches:
  [main]`, since main only advances through a passing PR and the two triggers were testing the same
  commit content twice.
- **MSW, scoped to the one real fetch boundary**: `src/lib/offline-manifest-store.ts`'s
  `syncOfflineManifest()` is a client component calling `fetch("/api/offline-manifests/sync")` — a
  genuine network boundary MSW is built for. `src/lib/offline-manifest-store.test.ts` uses `msw/node`
  to cover the applied/rejected/server-error response paths (including that a 500 leaves events
  `pending` rather than silently dropping them) with `fake-indexeddb/auto` standing in for the
  browser's IndexedDB. `src/app/api/offline-manifests/sync/route.test.ts` covers the route handler
  itself directly (it's a plain `Request -> Response` function, no Next request-scope dependency) —
  auth/staff gating, schema validation, and a successful roll-call write against a seeded
  `createTestDb()`. Both run in seconds under `pnpm test`, next to the rest of the unit suite.

## Alternatives considered

- **Rewrite all specs as Vitest + Testing Library, mocking `getDb()`/`auth()`** — the originally
  requested direction. Rejected once `connection()`/`notFound()`/`redirect()` proved to require an
  unsupported Next-internals shim, and Next's own docs steer away from it for exactly this reason.
- **MSW inside the browser via Playwright** (intercept the RSC/server-action HTTP traffic Next
  generates) — would require hand-reproducing Next's internal RSC wire format; far more fragile than
  the real server it would replace.
- **Keep the suite as-is, just raise timeouts/retries** — would have hidden the state-bleed bugs
  behind more retries rather than fixing them, and done nothing about the double CI run.

## Consequences

- E2e stays the source of truth for RSC/server-action flows, and is now isolated and roughly an
  order of magnitude faster in practice (no more retry pileup from cross-spec pollution).
- The reset endpoint is one more piece of test-only surface in `src/app/api/`; it's inert by
  construction outside a `DATABASE_URL`-less, non-production run, but a future agent adding a new
  mutable demo-schedule table must remember `resetDemoSchedule` (`src/db/seed.ts`) needs to cover it
  too, or reset-based isolation silently stops being complete.
- True parallel e2e execution (`fullyParallel`, `workers > 1`) still isn't safe — all specs share one
  dev-server process and one database. Revisit if e2e wall-clock becomes a problem again; the fix
  would be per-worker servers/databases, not a small change.
- New client-side fetch boundaries (another `/api/*` route with a browser caller) should get an MSW
  test alongside their Playwright coverage, following `offline-manifest-store.test.ts`'s pattern,
  rather than growing the Playwright suite for logic that doesn't need a real browser.
