import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "../../e2e/browser";
import { E2E_FROZEN_CLOCK, E2E_TEST_ROUTE_SECRET, e2eServerCommand } from "../../e2e/servers";
import { e2eServerEnv } from "../../playwright.config";
import { WALK_BASE_URL, WALK_PORT } from "./topology";

/**
 * The persona walk's own runner config (`pnpm personas`).
 *
 * One server, one browser, one spec, one worker. The personas are independent
 * of each other, but they read the same seeded demo shop and several of them
 * write to it (Rob books a seat), so running them in parallel would have one
 * persona's booking turn up in another's storefront and be reported as a
 * finding. A walk that costs a few minutes once a week is not worth that.
 *
 * The clock is the fleet's own frozen instant rather than a moving one: the
 * demo seed is clock-anchored, so a walk at a real 3am would find an empty
 * board and file it as a defect. Unlike the one-day simulation, nothing here
 * moves the clock — a persona looks at the shop as it stands.
 *
 * Deliberately not under `e2e/`: the fleet discovers every spec in that tree
 * and `scripts/e2e-shard.mjs` deals them into CI's shards, and this one belongs
 * to a weekly job that reports rather than to the pull-request gate.
 */
process.env.AUTH_SECRET ??= "diveday-e2e-secret";

export default defineConfig({
  testDir: ".",
  testMatch: /walk\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // One persona's whole walk is a handful of navigations, and the first pays
  // the one-time migrate and seed. Generous, because nothing here is being
  // timed; finite, because a hung navigation must end that persona's walk
  // rather than the night's.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? ([["github"], ["line"]] as const) : ([["line"]] as const),
  outputDir: "../../test-results/persona-bots",
  use: {
    baseURL: WALK_BASE_URL,
    launchOptions: chromiumLaunchOptions(),
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
    timezoneId: "America/New_York",
    colorScheme: "light",
    screenshot: "off",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: e2eServerCommand(WALK_PORT),
    // The supervisor and `next start` resolve from the repository root; a
    // webServer's cwd defaults to this config's own directory.
    cwd: path.resolve(__dirname, "../.."),
    url: WALK_BASE_URL,
    env: {
      ...e2eServerEnv,
      PORT: String(WALK_PORT),
      DIVEDAY_CLOCK: E2E_FROZEN_CLOCK,
    },
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 60_000,
  },
});
