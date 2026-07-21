import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import {
  E2E_FROZEN_CLOCK,
  E2E_WORKER_COUNT,
  e2eBaseURL,
  e2ePort,
  e2eWorkerIndexes,
} from "./e2e/servers";

// Sandboxed agent environments pre-install Chromium (often a different revision
// than this Playwright version expects) and block browser downloads. Prefer an
// explicit override, then the sandbox binary, then Playwright's own resolution.
const sandboxChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (!process.env.CI && fs.existsSync(sandboxChromium) ? sandboxChromium : undefined);

// Every worker server shares one read-only production build but owns an
// isolated in-memory database, so the suite runs fully parallel. `next start`
// is a production runtime, which forces a few settings dev handled implicitly:
//   - AUTH_SECRET must be explicit (the dev fallback is refused in production).
//   - AUTH_TRUST_HOST lets Auth.js accept the loopback test host.
//   - DIVEDAY_E2E re-opens /api/test/reset, which is otherwise closed in a
//     production runtime (see src/app/api/test/reset/route.ts).
const serverEnv = {
  ...process.env,
  DATABASE_URL: "",
  DATABASE_URL_UNPOOLED: "",
  PGLITE_DATA_DIR: "memory",
  DIVEDAY_E2E: "1",
  // Freeze the server clock so the clock-anchored seed and every relative
  // render resolve to one fixed instant on every run — the server half of what
  // keeps Argos baselines stable (the browser half is page.clock in
  // e2e/visual.spec.ts). src/lib/clock.ts reads this and, as a guard, ignores
  // it whenever a real DATABASE_URL is set, so it can never freeze production.
  DIVEDAY_CLOCK: E2E_FROZEN_CLOCK,
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
  expect: { timeout: 8_000 },
  timeout: 15_000,
  forbidOnly: !!process.env.CI,
  // No retries: a flake must fail the run so it gets fixed when it's found,
  // not silently papered over by a re-run. This is what keeps the suite honest
  // and fast — every failure is real and surfaces on the first attempt.
  retries: 0,
  // The Argos reporter collects the screenshots argosScreenshot() captures and
  // uploads them for visual diffing only when a token is configured — without
  // ARGOS_TOKEN (forks, local runs, pre-signup) it is a no-op and CI stays
  // green. See docs/architecture/decisions/20260721-argos-visual-regression.md.
  reporter: [
    ...(process.env.CI
      ? ([["github"], ["html", { open: "never" }]] as const)
      : ([["list"]] as const)),
    [
      "@argos-ci/playwright/reporter",
      { uploadToArgos: !!process.env.CI && !!process.env.ARGOS_TOKEN },
    ],
  ],
  use: {
    // Real base URL is assigned per worker in e2e/fixtures.ts; this is only a
    // sensible default for any context created outside a worker fixture.
    baseURL: e2eBaseURL(0),
    trace: "on-first-retry",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
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
      command: `./node_modules/.bin/next start --hostname 127.0.0.1 --port ${port}`,
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
