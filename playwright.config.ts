import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "./e2e/browser";
import {
  E2E_FROZEN_CLOCK,
  E2E_TEST_ROUTE_SECRET,
  E2E_WORKER_COUNT,
  e2eBaseURL,
  e2ePort,
  e2eWorkerIndexes,
} from "./e2e/servers";

// The worker servers and this runner process must agree on the signing secret:
// e2e/visual.spec.ts mints a signed recap token in this process (signRecapToken)
// and a worker server verifies it. Pin one resolved value into the environment
// before anything.
process.env.AUTH_SECRET ??= "diveday-e2e-secret";

// Every worker server shares one read-only production build but owns an
// isolated in-memory database, so the suite runs fully parallel. `next start`
// is a production runtime, which forces a few settings dev handled implicitly:
//   - AUTH_SECRET must be explicit (the dev fallback is refused in production).
//   - AUTH_TRUST_HOST lets Auth.js accept the loopback test host.
//   - DIVEDAY_E2E re-opens /api/test/reset, which is otherwise closed in a
//     production runtime (see src/app/api/test/reset/route.ts).
//   - DIVEDAY_E2E_SECRET is the bearer token every /api/test/* route also
//     requires (src/lib/e2e-test-routes.ts) — sent on every outgoing test
//     request below via `use.extraHTTPHeaders` and global-setup.ts's own
//     manual request context.
const serverEnv = {
  ...process.env,
  APP_HOST: "",
  DATABASE_URL: "",
  DATABASE_URL_UNPOOLED: "",
  PGLITE_DATA_DIR: "memory",
  DIVEDAY_E2E: "1",
  DIVEDAY_E2E_SECRET: E2E_TEST_ROUTE_SECRET,
  // Freeze the server clock so the clock-anchored seed and every relative
  // render resolve to one fixed instant on every run — the server half of what
  // keeps visual baselines stable (the browser half is the `context` init
  // script in e2e/fixtures.ts).
  // src/lib/clock.ts reads this and, as a guard, ignores
  // it whenever a real DATABASE_URL is set, so it can never freeze production.
  DIVEDAY_CLOCK: E2E_FROZEN_CLOCK,
  // The fleet can run as few as one worker (E2E_WORKER_COUNT), sharing one
  // server and one 127.0.0.1 "IP" across every spec file — real per-IP
  // throttling there would fail unrelated tests on nothing but replayed
  // shared state. src/lib/rate-limit.ts reads this and, like DIVEDAY_CLOCK
  // above, ignores it whenever a real DATABASE_URL is set.
  DIVEDAY_RATE_LIMIT_DISABLED: "1",
  AUTH_TRUST_HOST: "true",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "diveday-e2e-secret",
  // External providers are unit-tested through injected fetchers. Keeping them
  // out of the browser suite makes it deterministic without mocking our own
  // server or database.
  DIVEDAY_DISABLE_EXTERNAL_HTTP: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: E2E_WORKER_COUNT,
  // Precompiled servers serve routes without the dev-mode first-hit compile, so
  // warm assertions settle well under a second and tests finish in 1-4s each.
  // These timeouts are ceilings that only ever bound a *failure* — a stuck
  // assertion or a hung navigation — never a passing test. Keep them tight so a
  // broken test fails in seconds instead of stalling the run. 8s still clears
  // the one-time cold render of a heavy [id] page under parallel CPU load, and
  // 15s per test is ~4x the slowest real flow — enough headroom to never bite a
  // passing test, tight enough that a hang surfaces fast.
  //
  // The budget also covers the test's own **test-scoped** fixture setup (its
  // context, its page, the `/api/test/reset` in e2e/fixtures.ts) but not
  // worker-scoped setup, which is why a slow browser launch used to fail a test
  // that had not run a line yet. e2e/global-setup.ts pays that cold start up
  // front; see ADR 20260730-pinned-browser-visual-determinism before widening
  // this number in response to a setup timeout.
  expect: { timeout: 8_000 },
  timeout: 15_000,
  forbidOnly: !!process.env.CI,
  // No retries: a flake must fail the run so it gets fixed when it's found,
  // not silently papered over by a re-run. This is what keeps the suite honest
  // and fast — every failure is real and surfaces on the first attempt.
  retries: 0,
  // e2e/visual.spec.ts writes raw `page.screenshot()` PNGs into e2e/screenshots
  // (gitignored); `reg-suit` then diffs them against the baseline for this
  // branch's parent commit, pulled from S3. Nothing visual is committed to the
  // repo. See docs/architecture/decisions/20260729-reg-suit-visual-regression.md
  // and the `visual-triage` skill.
  reporter: process.env.CI
    ? ([["github"], ["html", { open: "never" }]] as const)
    : ([["list"]] as const),
  use: {
    // Real base URL is assigned per worker in e2e/fixtures.ts; this is only a
    // sensible default for any context created outside a worker fixture.
    baseURL: e2eBaseURL(0),
    // Both used to be no-ops: `trace: "on-first-retry"` never fires with
    // `retries: 0` (see the comment on that setting below), so CI has been
    // capturing zero visual/trace evidence on failure this whole
    // investigation — every failing-test diagnosis so far came from a local
    // repro, never the actual CI run that failed. "only-on-failure" and
    // "retain-on-failure" cost nothing on a passing run and upload alongside
    // the existing playwright-report-<shard> artifact on a failing one.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Which Chromium, and the flags that make it rasterize reproducibly — see
    // e2e/browser.ts for why each one is there and what it costs.
    launchOptions: chromiumLaunchOptions(),
    // Every /api/test/* route now requires this bearer token in addition to
    // its env-var predicate (src/lib/e2e-test-routes.ts). Setting it here
    // once covers every spec's `request`/`context`/`page` fixture (including
    // e2e/fixtures.ts's auto `demoReset` reset) without touching each call
    // site; it's a harmless extra header on ordinary page navigations, which
    // the app never reads outside these test-only routes.
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // One precompiled `next start` server per worker. Playwright waits for all of
  // them before running. A production build must already exist — `pnpm e2e`
  // runs `next build` first; iterating with `playwright test` directly reuses
  // whatever build is on disk.
  webServer: e2eWorkerIndexes.map((i) => {
    const port = e2ePort(i);
    return {
      // `--keepAliveTimeout` well above Node's 5s default, because the request
      // fixture is long-lived and pools its sockets. Every test opens one for
      // the `/api/test/reset` in fixtures.ts, then the body runs — an onboarding
      // flow or a booking journey, comfortably past five seconds — and a later
      // `request.post` to a test endpoint reuses that idle socket. If the server
      // has closed it in the meantime the POST lands on a dead connection and
      // fails with ECONNRESET, in whichever spec happened to pause longest
      // between two API calls. Widening the server's idle window closes the
      // whole class rather than retrying at each call site.
      command: `./node_modules/.bin/next start --hostname 127.0.0.1 --port ${port} --keepAliveTimeout 120000`,
      url: e2eBaseURL(i),
      env: { ...serverEnv, PORT: String(port) },
      reuseExistingServer: !process.env.CI,
      // `next start` serves a build that already exists on disk, so it boots in
      // seconds; 60s covers a cold, contended CI runner without making a
      // failed boot hang the run for two minutes.
      timeout: 60_000,
    };
  }),
});
