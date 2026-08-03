# Testing

## Layers

| Layer | Tool | Where | What it proves |
| --- | --- | --- | --- |
| Unit | Vitest | colocated `src/**/*.test.ts(x)` | domain logic: cert gating, capacity, pricing, formatting |
| Component | Vitest + Testing Library | colocated | interactive components behave (role-based queries) |
| Fetch boundary | Vitest + MSW | colocated, e.g. `offline-manifest-store.test.ts` | client code that calls a real `/api/*` route — narrow, see [ADR 20260719](../architecture/decisions/20260719-msw-offline-sync-only.md) |
| E2E | Playwright | `e2e/*.spec.ts` | critical user flows survive integration |
| Visual | reg-suit + S3 | `e2e/visual.spec.ts`, `.reg/` | key surfaces (light + dark × phone + desktop, plus print) still look right — see [ADR 20260729](../architecture/decisions/20260729-reg-suit-visual-regression.md) |

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
pnpm visual        # capture screenshots and run reg-suit comparison and publish to S3
pnpm check         # repo safeguards + lint + typecheck + unit — the pre-commit bar
```

## The route coverage ledger

`scripts/route-coverage.json` lists every `src/app/**/page.tsx` route and the tests that cover it:
the `e2e/*.spec.ts` files that drive a flow landing there, and the `e2e/visual.spec.ts` captures
that photograph it. `pnpm check:route-coverage` (part of `pnpm check:repo`) keeps that list honest
against the tree — every route present, no stale entries, every named spec file and capture name
real, and a written `exempt` reason for any route that has neither.

It exists because a page with no test is silent by construction: it produces no failure for anyone
to notice. A 2026-08-03 evaluation of the test system found three staff pages that had shipped with
neither an e2e spec nor a visual capture — `/shop/[shopSlug]/orders/new`,
`/shop/[shopSlug]/dive-sites/catalog`, and `/shop/[shopSlug]/staffing`. They are the ledger's three
exemptions today, and closing one means writing the spec and deleting the exemption in the same
change.

The coverage lists are hand-maintained, deliberately. A spec usually reaches a route by *clicking*
— `e2e/waivers.spec.ts` gets to `/waivers/[token]` by pressing "Send waiver" and following the link
out of a toast — and no grep sees that. A guess would either invent coverage or demand exemptions
for well-covered routes, and the second failure is how a gate becomes a rubber stamp. What is
mechanical (which routes, specs, and captures exist) is re-derived every run.

```bash
node scripts/check-route-coverage.mjs            # the gate
node scripts/check-route-coverage.mjs --report   # per-route table: ok / GAP / EXEMPT
node scripts/check-route-coverage.mjs --write    # regenerate the mechanical facts
```

`--write` is a ratchet, like `scripts/check-copy.mjs`. It adds an entry for a new route (empty, and
without an exemption — so the check goes red until someone writes a test or types a reason), drops
an entry for a deleted route, and banks a closed gap by removing an exemption the route has
outgrown. It will never add an exemption or remove a spec or capture from a route's lists; if a
listed spec or capture has vanished it refuses and says so, and `--absorb` is the loud escape hatch
for the one honest case — a merge from a branch that deleted it.

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

`vitest.config.ts` sets `pool: "threads"` (Vitest 4 otherwise defaults to `forks`, one child process
per test file): reusing one process across files skips Node's startup and the module-graph re-import
(Next, Drizzle, PGlite's WASM) that every fresh fork repays, without weakening per-file isolation —
`isolate` still gives each file its own module registry regardless of pool. Measured ~13% faster on
the full suite locally with identical pass counts across repeated runs.

## Conventions

- **Test behavior, not implementation.** Query the DOM by role/label, assert outcomes; don't
  reach into component internals or test styling classes.
- **Prefer `getByRole`/`getByLabel` over `getByText` in Playwright specs**, but don't hand-roll the
  visibility filter — `e2e/fixtures.ts`'s `page` fixture patches `getByText`, `getByRole`,
  `getByLabel`, and `getByPlaceholder` to `.filter({ visible: true })` automatically, so a
  React `<Activity mode="hidden">` boundary (`cacheComponents`, on since
  [ADR 20260801-cache-components-e2e-activity-migration](../architecture/decisions/20260801-cache-components-e2e-activity-migration.md))
  can't strict-mode-fail a `page.<query>(...)` call against a hidden previous route. A raw
  `.locator()` used as a final matcher, or a second actor's page opened via
  `browser.newContext()`/`context.newPage()` (wrap it with `makeActivitySafe(...)`, also exported
  from `./fixtures`), aren't covered by the fixture and need the filter or wrapper at the call
  site. See the **e2e-and-visual** skill for the full pattern and its exceptions (elements with no
  layout box, intentional hidden-element assertions).
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
- **Every `/api/test/*` route is guarded, and that is enforced.** The harness's own endpoints
  (`reset` plus the `seed-*` routes) reset and seed state and mint real tokens — `seed-account-token`
  hands back a valid password-reset or invite token for any account by email — so each handler must
  open with `e2eTestRouteAuthorized(request)` (`src/lib/e2e-test-routes.ts`: env predicate plus a
  `DIVEDAY_E2E_SECRET` bearer token, failing closed). `pnpm check:e2e-fixtures` fails when a handler
  under `src/app/api/test/**` doesn't call it, and each route carries auth-gate unit tests asserting
  the refusal lands before any database work.
- **Safety-critical logic** (manifest counts, roll-call state, cert gating) merges only with
  tests for the failure paths, not just the happy path.
- **Visual regression freezes the clock, never masks.** Playwright visual tests in
  `e2e/visual.spec.ts` capture each on-screen surface at light/dark ×
  phone/desktop and the two dock surfaces in print mode. Nothing is masked: the server clock is
  pinned by `DIVEDAY_CLOCK` and the browser clock by fixture setup, so
  clock-derived text is pixel-stable and a regression in a date remains visible. Nothing in that
  spec asserts — it writes raw PNGs into `e2e/screenshots/` (gitignored) — so a visual change never
  shows up as a failed Playwright test. `pnpm visual` runs the capture and then `reg-suit run`,
  which diffs against the S3 baseline for the parent commit and publishes the run and its HTML
  report. There is no local baseline to update: merging is what makes a change the next baseline.

## Adding a test

Unit: create `thing.test.ts` next to `thing.ts` — Vitest picks it up. Component: same, `.tsx`,
setup already imports jest-dom matchers. Fetch boundary: same, using `msw/node`'s `setupServer` —
see `src/lib/offline-manifest-store.test.ts`. E2E: add `e2e/flow.spec.ts`, importing `test`/`expect`
from `./fixtures` (not `@playwright/test`) so it gets the per-worker server and per-test reset; the
config builds and boots the server fleet itself.

Whichever routes the new e2e spec or visual capture reaches, add its name to those routes' entries
in `scripts/route-coverage.json` — the same change, not a follow-up. If it closes a gap, delete
that route's `exempt` line while you are there.
