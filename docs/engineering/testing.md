# Testing

## Layers

| Layer | Tool | Where | What it proves |
| --- | --- | --- | --- |
| Unit | Vitest | colocated `src/**/*.test.ts(x)` | domain logic: cert gating, capacity, pricing, formatting |
| Component | Vitest + Testing Library | colocated | interactive components behave (role-based queries) |
| Fetch boundary | Vitest + MSW | colocated, e.g. `offline-manifest-store.test.ts` | client code that calls a real `/api/*` route — narrow, see [ADR 20260719](../architecture/decisions/20260719-msw-offline-sync-only.md) |
| Real Postgres | Vitest + a service container | `src/db/*.postgres.test.ts` | the committed `drizzle/` migrations apply to a genuine server, and the `FOR UPDATE` guards actually hold under two concurrent connections — see [below](#the-real-postgres-suites) |
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

### Why `playwright-core` is pinned in devDependencies

`playwright-core` is declared explicitly at the exact version `@playwright/test` resolves to. It is
not a dependency anything imports directly — it is there to decide which copy `@axe-core/playwright`
binds its `playwright-core` **peer** to.

Without the pin, two copies sit in the tree: `@playwright/test`'s, and the exact alpha that
`@playwright/mcp` pins for its own use. pnpm picked the higher one for the peer, so `AxeBuilder`
wanted a `Page` from one copy while `e2e/a11y.spec.ts` had one from the other — structurally the
same object, a hard `tsc` error, and nothing about the message says "you have two Playwrights". That
is how `main` went red on typecheck after a routine package bump.

Keep the pin equal to `@playwright/test`'s version when either moves. One browser driver in the
tree is also what ADR 20260730-pinned-browser-visual-determinism assumes.

## The route coverage ledger

`scripts/route-coverage.json` lists every `src/app/**/page.tsx` route and the tests that cover it:
the `e2e/*.spec.ts` files that drive a flow landing there, and the `e2e/visual.spec.ts` captures
that photograph it. `pnpm check:route-coverage` (part of `pnpm check:repo`) keeps that list honest
against the tree — every route present, no stale entries, every named spec file and capture name
real, and a written `exempt` reason for any route that has neither.

It exists because a page with no test is silent by construction: it produces no failure for anyone
to notice. A 2026-08-03 evaluation of the test system found three staff pages that had shipped with
neither an e2e spec nor a visual capture — `/shop/[shopSlug]/orders/new`,
`/shop/[shopSlug]/dive-sites/catalog`, and `/shop/[shopSlug]/staffing`. All three have since been
covered and the ledger holds no exemptions; closing a future one means writing the spec and
deleting the exemption in the same change.

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

## The real-Postgres suites

PGlite is the right default for everything above, but it is **single-connection**, and it is not the
engine production runs. Two claims are therefore unprovable on it, and both were live gaps:

- **The migrations had never met a real server before the production deploy did.** PGlite satisfies
  `CREATE EXTENSION pg_trgm` out-of-band, with a wasm extension loaded in JavaScript before any
  migration runs — so `drizzle/` could contain Postgres-invalid SQL and the whole suite stays green.
- **No `FOR UPDATE` in `src/db/` had ever been contended.** Two transactions cannot sit in the same
  critical section on one connection, so the oversell guard in `createBookingRecord` and the
  serialization in `withBookingPaymentLock` could both be deleted without a single test failing.
  `src/db/money-replay.test.ts` states the same limitation from the money side.

The `src/db/*.postgres.test.ts` suites close those — all opt-in, all skipped unless a server is
named, and all picked up by that glob rather than by a list anyone has to remember to update:

| File | Proves |
| --- | --- |
| `migrations.postgres.test.ts` | `drizzle/` applies from empty, *and* on top of the previous release's schema, *and* both land on an identical schema (read from `information_schema`/`pg_constraint`, not from Drizzle's model) |
| `bookings.postgres.test.ts` | Two — and five — genuinely concurrent transactions racing for the last seat sell exactly the seats that exist |
| `payments.postgres.test.ts` | Two simultaneous payment writes leave one unbroken `booking_payment_events` chain rather than a fork |
| `refunds.postgres.test.ts` | Two — and five — simultaneous taps of Refund on one paid order reach Stripe exactly once; the losers are refused locally with `in_progress` rather than by Stripe's over-refund rejection (PAY-L3) |
| `postgres-harness.postgres.test.ts` | The harness itself: finishing a test never terminates a connection that is still alive, and an unreleased `holdRowLock` gate does not hang teardown |

A new suite needs no wiring beyond the name: write `src/db/<thing>.postgres.test.ts` against
`@/test/postgres` and CI runs it. Do not add one outside that glob — it would skip in the unit shards
for want of `DIVEDAY_TEST_POSTGRES_URL` and never run anywhere else.

### Reading a race test correctly

These use `holdRowLock` + `waitForLockWaiters` from `src/test/postgres.ts`. A third connection takes
the contested row's lock first; the contenders are started and the test waits until Postgres itself
reports them all parked on it before the gate is released. Without that, "fire two promises and
assert one won" passes for a sequential run exactly as it does for a contended one.

**The gate establishes simultaneity; it does not detect the guard.** This is worth stating plainly
because the intuitive reading is wrong: a contender blocks on the gate whether or not the code under
test locks anything, because its `INSERT` takes a `KEY SHARE` lock on the referenced row during the
foreign-key check, and that already conflicts with the gate's `FOR UPDATE`. What catches a missing
guard is always the **outcome** assertion — the seat count, the event chain.

That is measured, not assumed. Deleting the `.for("update")` in `createBookingRecord` and rerunning:
`waitForLockWaiters` still passes, and the one-seat trip sells **2** seats while the two-seat trip
sells **5**. Deleting it in `withBookingPaymentLock`: both payment events come back claiming no
predecessor — a forked trail. Anyone tempted to simplify these tests should re-run that experiment
first.

For the same reason, **never order a race test's rows by a column that does not order the writes**.
`booking_payment_events.id` is `defaultRandom()`, `occurred_at` comes from the frozen clock and is
identical across contenders, and `created_at`'s `now()` is transaction-*start* time — the same
instant for two contenders released from one gate. An earlier draft of the payments test sorted by
`id` and passed about half the time. Assert the invariant (follow `previous_status` to rebuild the
chain), not an incidental storage order.

**A fake that returns instantly is not a stand-in for a network round trip, and the difference is a
flake.** `refunds.postgres.test.ts` asserts the losing taps are refused with `in_progress` while the
winner is away at Stripe. In production that call takes hundreds of milliseconds and the losers
certainly answer inside it; against a fake provider that resolved on the next microtask the winner
came straight back, asked for the order row again to write `status = 'refunded'`, and could be
granted that lock ahead of losers still queued — which then read a refunded order and answered
`not_paid`. Correct behaviour, different refusal, red test:
`in_progress, not_paid, not_paid, not_paid, refunded` turned up once in fifteen full-suite runs. The
fix is `tapsMeetingAtStripe`, which holds the winner inside the provider until every other tap has
answered, so the scenario the test describes is the scenario it runs. It counts a tap that *reaches*
the provider as having arrived, not only one that answered — otherwise deleting the guard (all five
claim, all five reach Stripe, none can answer) would deadlock and report a timeout instead of the
five idempotency keys that are the real evidence.

### The teardown may not drop a database out from under a live connection

`await pool.end()` does **not** mean the server-side connections are gone. pg-pool's shutdown removes
each idle client from its own bookkeeping synchronously and then calls the asynchronous
`client.end()` without waiting for it, so the promise resolves once a Terminate message has been
*queued* — measured on pg-pool 3.14.0, seven pools opened, queried and ended together left a live
backend behind in **153 of 200** iterations.

The teardown in `src/test/postgres.ts` used to follow that straight into
`DROP DATABASE … WITH (FORCE)`, which terminates whatever is still attached — so it was racing the
graceful disconnects it had itself just started. When the drop won, the surviving client took
`FATAL 57P01 terminating connection due to administrator command` with no query in flight, pg
re-emitted it as an unhandled `'error'` event on its pool, and the job died reporting
`Tests 9 passed (9)` and `Errors 1 error` in the same summary (observed on f476e58). Every assertion
in the suites had already passed; nothing they check could have caught it.

Teardown now waits for `pg_stat_activity` to report the scratch database empty and then drops it
without `FORCE`, so there is nothing left to terminate. `FORCE` survives only on the path where the
wait times out — a connection that never drained is a real leak, so that path drops the database
anyway (no orphans on the server) and then **fails the test** naming it. Two rules follow for anyone
touching the harness:

- **Every pool it creates gets an `error` listener.** A `pg.Pool` without one turns any death of an
  idle client into an uncaught exception that kills the worker; the harness collects them instead and
  reports them against the test that caused them. Collected, never swallowed.
- **A `holdRowLock` gate is released even if the test never releases it.** Its transaction otherwise
  never commits, its client never returns to the pool, and `pool.end()` — which *does* wait for
  checked-out clients — waits forever, so an ordinary assertion failure is reported as a teardown
  timeout. The safety release is an `onTestFinished` registered inside `holdRowLock`; Vitest runs
  those in reverse registration order, so it always runs before the teardown that closes its pool.

`postgres-harness.postgres.test.ts` holds both to account, and does it by arranging the race rather
than waiting for it: a race that fires on a small fraction of runs proves nothing when it does not
fire.

### Running the real-Postgres suites locally

One environment variable is the whole switch. It is deliberately **not** `DATABASE_URL` — that is
what `getDb()` reads, and `vitest.config.ts` and `src/test/global-setup.ts` both pin it to `""` so no
test can reach a real database by accident. Reusing it would point every unrelated test in the run at
the server.

```bash
docker run --rm -d --name diveday-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16

DIVEDAY_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres \
  pnpm exec vitest run --reporter=dot src/db/*.postgres.test.ts
```

Any Postgres 16 reachable by URL works — a local `initdb`/`pg_ctl` cluster is fine, and the account
needs `CREATEDB` because each test creates and drops its own scratch database. Run it against a
server holding anything you care about and it will happily create databases there; point it at a
throwaway.

With the variable unset, `describePostgres` registers a skipped suite: no connection attempted, no
service required, `pnpm check` and CI's four unit shards completely unaffected. If these ever *fail*
rather than skip on a plain `pnpm test`, that is a bug in the harness, not a missing server.

The second migration test needs real git history (it reconstructs the previous release's `drizzle/`
tree via `scripts/previous-release-migrations.mjs`) and **throws rather than skips** when it cannot
resolve a base commit — deliberately, so a too-shallow clone cannot quietly turn it into a test that
proves nothing. On a shallow local clone, `git fetch --unshallow`.

### In CI

The `real-postgres` job in `.github/workflows/ci.yml` runs them all against a `postgres:16` service
container. It is gated two ways: on any PR touching `src/db/**`, `drizzle/**`, or the harness, and on
a nightly `schedule:` regardless of the diff — because what invalidates the proof usually arrives
from another branch. Every pre-existing job in that workflow carries
`if: github.event_name != 'schedule'` so the nightly runs this job and nothing else; those guards are
load-bearing. What the job does *not* prove — anything involving production data volumes — is in
[deploy-and-migrations-runbook.md](deploy-and-migrations-runbook.md#what-ci-rehearses-and-what-it-still-doesnt).

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
