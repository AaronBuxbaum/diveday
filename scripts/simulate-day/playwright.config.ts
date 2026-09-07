import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "../../e2e/browser";
import { E2E_TEST_ROUTE_SECRET, e2eServerCommand } from "../../e2e/servers";
import { e2eServerEnv } from "../../playwright.config";
import { SIMULATION_BASE_URL, SIMULATION_DAY_START, SIMULATION_PORT } from "./topology";

/**
 * The one-day simulation's own runner config (`pnpm simulate:day`).
 *
 * One server, one browser, one spec, run in order: the day is a chain of
 * states and every one depends on the ones before it, so there is nothing to
 * parallelise and `fullyParallel` would be wrong rather than slow. The server
 * is the fleet's own worker server — same supervisor, same production build,
 * same pinned environment (`e2eServerEnv`) — started at a different instant:
 * `DIVEDAY_CLOCK` begins at the shop's opening and the spec moves it forward
 * through `/api/test/clock`, which is the one thing the shared fleet never
 * does, because there a worker's clock belongs to every spec it runs.
 *
 * Deliberately not under `e2e/`: the fleet discovers every spec in that tree
 * (and `scripts/e2e-shard.mjs` deals them into CI's shards), and this one takes
 * minutes, owns its clock, and belongs to a nightly job rather than the
 * pull-request gate.
 */
process.env.AUTH_SECRET ??= "diveday-e2e-secret";

export default defineConfig({
  testDir: ".",
  testMatch: /day\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // A state is a handful of navigations and writes against a warm server, and
  // the first one pays the one-time migrate + seed. Generous, because the day
  // is what is being measured and the transcript records how long each state
  // really took; still finite, because a hung navigation must fail the state
  // rather than the night.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? ([["github"], ["line"]] as const) : ([["line"]] as const),
  outputDir: "../../test-results/simulate-day",
  use: {
    baseURL: SIMULATION_BASE_URL,
    launchOptions: chromiumLaunchOptions(),
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
    timezoneId: "America/New_York",
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1279, height: 720 },
  },
  webServer: {
    command: e2eServerCommand(SIMULATION_PORT),
    // The supervisor and `next start` resolve from the repository root; a
    // webServer's cwd defaults to this config's own directory.
    cwd: path.resolve(__dirname, "../.."),
    url: SIMULATION_BASE_URL,
    env: {
      ...e2eServerEnv,
      PORT: String(SIMULATION_PORT),
      DIVEDAY_CLOCK: SIMULATION_DAY_START,
    },
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 60_000,
  },
});
