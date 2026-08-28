import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "./e2e/browser";
import {
  E2E_APP_HOST,
  E2E_CRON_SECRET,
  E2E_FROZEN_CLOCK,
  E2E_TEST_ROUTE_SECRET,
  E2E_WORKER_COUNT,
  e2eBaseURL,
  e2ePort,
  e2eServerCommand,
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
  // A real, non-loopback public origin so `publicAppUrl()` resolves fleet-wide
  // — see E2E_APP_HOST in e2e/servers.ts for what that unlocks, why nothing
  // needs the hostname to resolve, and why it must match `pnpm e2e:build`.
  APP_HOST: E2E_APP_HOST,
  DATABASE_URL: "",
  DATABASE_URL_UNPOOLED: "",
  PGLITE_DATA_DIR: "memory",
  DIVEDAY_E2E: "1",
  DIVEDAY_E2E_SECRET: E2E_TEST_ROUTE_SECRET,
  // Lets a spec fire a scheduled pass — see E2E_CRON_SECRET in e2e/servers.ts.
  CRON_SECRET: E2E_CRON_SECRET,
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
  // Lets the WhatsApp settings page actually store a (fake) shop credential,
  // which is what the connect flow is about (ADR
  // 20260802-whatsapp-cloud-api-per-shop). A fixed value, not a secret: these
  // servers hold only seeded demo data. Without it the page correctly refuses
  // to save, and the flow has nothing to exercise.
  // It also seals the live copy of a waiver link, which is what lets a second
  // send hand back the same URL instead of minting one (ADR
  // 20260820-waiver-links-are-reused-not-reissued) — so waivers.spec.ts's
  // "the same link comes back" assertion depends on this being set too.
  SECRET_ENCRYPTION_KEY: "ZGl2ZWRheS1lMmUtZW5jcnlwdGlvbi1rZXktMzJieXQ=",
  // Same reasoning as SECRET_ENCRYPTION_KEY above: fixed, non-secret values so
  // the manifest's Web Push opt-in renders at all (ADR
  // 20260804-manifest-web-push — the control hides itself when the server has
  // no keys, which would otherwise make it invisible to both the e2e spec and
  // the visual capture). A real key pair is never needed here: no test sends a
  // push, and DIVEDAY_DISABLE_EXTERNAL_HTTP blocks the attempt regardless. The
  // public key is a valid 65-byte P-256 point in base64url so the browser's own
  // `applicationServerKey` parsing is exercised rather than short-circuited.
  VAPID_PUBLIC_KEY:
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  VAPID_PRIVATE_KEY: "UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls",
  VAPID_SUBJECT: "mailto:e2e@dive.day",
  // Names the bucket that media URLs belong to, without the credentials to
  // reach it. `isManagedStorageUrl` (src/lib/storage/blob-host.ts) derives
  // "one of ours" from the configured bucket rather than from a hostname
  // suffix, and it gates `queueMediaDeletion` -- so with no bucket named, the
  // stuck-deletion row that `/api/test/seed-trouble-states` exists to create
  // is silently never created, and the Settings panel the visual capture
  // photographs never renders. No key id or secret: an upload must still
  // report `not_configured` here, as every other provider in this fleet does.
  MEDIA_BUCKET_NAME: "diveday-media",
  MEDIA_AWS_REGION: "us-east-1",
  NEXT_TELEMETRY_DISABLED: "1",
  // `next start` loads `.env.local` itself (via `@next/env`) before this
  // config ever runs, and `...process.env` above only reflects this CLI
  // process's own shell env — it does nothing to stop that file's values from
  // reaching the spawned server. A developer's real provider credentials
  // there (SES, Stripe, SNS/SMS, Meta WhatsApp) would otherwise make a
  // provider that every comment in this fleet documents as unconfigured
  // (e.g. E2E_APP_HOST above: "Stripe checkout stays `disabledCheckoutProvider`
  // with no STRIPE_SECRET_KEY") actually configured — risking a real outbound
  // call despite `DIVEDAY_DISABLE_EXTERNAL_HTTP`, which only covers the three
  // integrations that read it directly, not these provider adapters. Blanked
  // the same way `DATABASE_URL` is above, so the fleet's providers stay
  // `disabled`/`not_configured` regardless of what's in a developer's
  // `.env.local`.
  SES_AWS_REGION: "",
  SES_AWS_ACCESS_KEY_ID: "",
  SES_AWS_SECRET_ACCESS_KEY: "",
  SES_FROM_EMAIL: "",
  SES_SNS_TOPIC_ARN: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_CONNECT_CLIENT_ID: "",
  SNS_AWS_REGION: "",
  SNS_AWS_ACCESS_KEY_ID: "",
  SNS_AWS_SECRET_ACCESS_KEY: "",
  SNS_SENDER_ID: "",
  META_APP_ID: "",
  META_APP_SECRET: "",
  META_WHATSAPP_SIGNUP_CONFIG_ID: "",
  // A real DSN here would have the server (and, since it's inlined at build
  // time too — see `e2e:build` in package.json — the browser) actually
  // initialize Sentry and ship real events from every e2e run.
  NEXT_PUBLIC_SENTRY_DSN: "",
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
    // The browser's own zone, pinned for the same reason the clock is frozen:
    // sign-up's picker now preselects whatever `Intl.DateTimeFormat()` reports
    // (src/components/DetectTimezone.tsx), so an unpinned runner would hand a
    // CI container and a developer's laptop two different shops. Pinned to the
    // seeded demo shop's own zone, so the fleet's default is a no-op; the spec
    // that actually exercises detection overrides it per test.
    timezoneId: "America/New_York",
  },
  projects: [
    {
      name: "chromium",
      // **1279, not Desktop Chrome's 1280 — one pixel below the week board's
      // `xl` floor.** From that width up the staff board composes as a
      // seven-column week and the vertical day stream is `display:none`
      // (H-63, ADR 20260827-clearwater-surface-language). The stream is the
      // composition every flow spec in this suite is written against — it
      // carries the add panel, the row menu and the cursor pager, and it is
      // what tablets and phones get — so the functional fleet drives the app
      // at the widest width the stream renders. The board's own spec sets
      // 1280 explicitly to read the week, and e2e/visual.spec.ts sets its own
      // 390 / 820 / 1280 viewports, so both compositions are still
      // photographed and exercised.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1279, height: 720 } },
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
      command: e2eServerCommand(port),
      url: e2eBaseURL(i),
      env: { ...serverEnv, PORT: String(port) },
      // Reusing a local server turns an orphan into a silent stale-build
      // failure. Let Playwright fail loudly on a port collision so the
      // supervisor's cleanup path, and the process table, remain actionable.
      reuseExistingServer: false,
      // Routine application logs (including one structured web-vital line per
      // page) are written to stdout. Forwarding that stream makes every
      // Playwright run noisy with `[WebServer]` telemetry. Keep stderr piped so
      // startup and request failures still appear when the server is broken.
      stdout: "ignore",
      stderr: "pipe",
      // `next start` serves a build that already exists on disk, so it boots in
      // seconds; 60s covers a cold, contended CI runner without making a
      // failed boot hang the run for two minutes.
      timeout: 60_000,
    };
  }),
});
