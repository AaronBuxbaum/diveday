# Testing

## Layers

| Layer | Tool | Where | What it proves |
| --- | --- | --- | --- |
| Unit | Vitest | colocated `src/**/*.test.ts(x)` | domain logic: cert gating, capacity, pricing, formatting |
| Component | Vitest + Testing Library | colocated | interactive components behave (role-based queries) |
| Fetch boundary | Vitest + MSW | colocated, e.g. `offline-manifest-store.test.ts` | client code that calls a real `/api/*` route — narrow, see [ADR 20260719](../architecture/decisions/20260719-msw-offline-sync-only.md) |
| E2E | Playwright | `e2e/*.spec.ts` | critical user flows survive integration |

Almost every page in `src/app/` is an `async function Page()` reading the database directly and
mutating through inline `"use server"` closures — not a client fetching JSON. That's exactly the
shape Next's own docs say Vitest doesn't support (`node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`).
Don't reach for MSW or Testing Library to cover a flow like that; it belongs in `e2e/`. MSW is for
the rare case where a client component makes a real `fetch` to one of our own routes (see the ADR).

## Commands

```bash
pnpm test          # unit + component, once
pnpm test:watch    # during development
pnpm e2e           # Playwright (auto-detects sandbox Chromium; CI installs its own)
pnpm check         # lint + typecheck + unit — the pre-commit bar
```

## The test database is a snapshot, not a boot

Database-backed tests call `seededTestDb()` / `seededShopContext()` from `@/test/db`. They still
get a fully isolated in-memory PGlite database per test — but it is hydrated from a template
snapshot (migrated + demo-seeded, built once per run by `src/test/global-setup.ts` and cached in
`node_modules/.cache/diveday/`), not by replaying migrations per test. Replaying was ~3s per test;
hydrating is a few hundred milliseconds. Two rules keep this sound:

- Never cache or share a database across tests; call the helper per test.
- Don't call `createTestDb()` + `seedDemo()` directly in tests — that's the slow path the helper
  exists to avoid. (`createTestDb()` alone is fine for the rare test that wants an *unseeded* db.)

The snapshot is keyed on a content hash of `drizzle/` and `src/db/` and expires after 10 minutes,
because the demo seed is clock-anchored (one trip always sails *today*); staleness cannot outlive
the shortest seeded future departure.

Vitest defaults to the `node` environment. A test that exercises browser APIs (DOM rendering,
IndexedDB, `navigator`) opts in with a `// @vitest-environment jsdom` docblock on line 1.

## Conventions

- **Test behavior, not implementation.** Query the DOM by role/label, assert outcomes; don't
  reach into component internals or test styling classes.
- **Domain logic is where coverage lives.** `src/lib/` functions get thorough cases — edges
  included (full boat, expired service, uncertified diver, physician-flagged medical). UI tests
  stay thin.
- **Time and zone are explicit.** Any date/time test passes an explicit `timeZone`; never depend
  on the runner's locale or clock. Fixed dates, not `new Date()`.
- **E2E is a smoke layer, not a matrix.** One spec per critical flow (book a trip, sign a
  waiver, run roll call), kept fast and unflaky; edge cases belong in unit tests.
- **E2E keeps real application boundaries and disables third-party HTTP.** Exercise Next, auth,
  and the isolated PGlite database together. Test provider adapters with injected fakes in Vitest;
  do not add browser-level service-worker mocks for server-side providers.
- **E2E staff tests reuse a per-worker session.** Each worker signs in through the real form
  once (`ownerStorageState` in `e2e/fixtures.ts`) and staff specs opt in with
  `signedInAsOwner()` at file or describe scope instead of walking the sign-in form per test.
  `auth.spec.ts` — and the mid-flow sign-out/sign-in legs of the booking loop — still exercise
  the live form; tests that must start signed out simply don't opt in.
- **E2E runs parallel against a precompiled server fleet.** `pnpm e2e` builds once (`next build`)
  and Playwright starts one `next start` server per worker, each with its own in-memory PGlite
  database (`e2e/servers.ts`, `playwright.config.ts`). Precompiled routes avoid the dev-mode
  first-hit compile; the isolated per-worker databases let specs run `fullyParallel`. Every spec
  imports `test`/`expect` from `e2e/fixtures.ts`, not `@playwright/test` directly — the fixtures
  point each worker at its own server and reset the demo shop's schedule (`POST /api/test/reset`)
  before each test, so mutations in one spec can't change what another asserts on. Iterating on a
  single spec, `playwright test <spec>` reuses the existing build; `next start`'s production runtime
  needs `AUTH_SECRET`/`AUTH_TRUST_HOST` and the `DIVEDAY_E2E` reset opt-in, which the config supplies.
- **Safety-critical logic** (manifest counts, roll-call state, cert gating) merges only with
  tests for the failure paths, not just the happy path.

## Adding a test

Unit: create `thing.test.ts` next to `thing.ts` — Vitest picks it up. Component: same, `.tsx`,
setup already imports jest-dom matchers. Fetch boundary: same, using `msw/node`'s `setupServer` —
see `src/lib/offline-manifest-store.test.ts`. E2E: add `e2e/flow.spec.ts`, importing `test`/`expect`
from `./fixtures` (not `@playwright/test`) so it gets the per-worker server and per-test reset; the
config builds and boots the server fleet itself.
