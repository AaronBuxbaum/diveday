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
- **E2E specs share one dev-server and one database** (`getDb()` memoizes a single connection for
  the process's life; specs run serially, `playwright.config.ts`). Every spec imports `test`/
  `expect` from `e2e/fixtures.ts`, not `@playwright/test` directly — its `beforeEach` resets the
  demo shop's schedule (`POST /api/test/reset`) before each test so mutations in one spec can't
  change what another spec asserts on.
- **Safety-critical logic** (manifest counts, roll-call state, cert gating) merges only with
  tests for the failure paths, not just the happy path.

## Adding a test

Unit: create `thing.test.ts` next to `thing.ts` — Vitest picks it up. Component: same, `.tsx`,
setup already imports jest-dom matchers. Fetch boundary: same, using `msw/node`'s `setupServer` —
see `src/lib/offline-manifest-store.test.ts`. E2E: add `e2e/flow.spec.ts`, importing `test`/`expect`
from `./fixtures` (not `@playwright/test`) so it gets the per-test reset; the config boots the dev
server itself.
