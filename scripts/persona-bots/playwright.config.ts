import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "../../e2e/browser";
import { E2E_TEST_ROUTE_SECRET, e2eServerCommand } from "../../e2e/servers";
import { e2eServerEnv } from "../../playwright.config";
import { PERSONA_BASE_URL, PERSONA_PORT } from "./topology";

/**
 * The weekly persona walk's own runner config (`pnpm persona:bots`).
 *
 * The same shape as `scripts/simulate-day/playwright.config.ts`, and for the
 * same reasons: one of the e2e fleet's own worker servers — same supervisor,
 * same production build, same pinned environment — under a config of its own,
 * because this run belongs to a weekly job rather than to the pull-request
 * gate, and because the fleet discovers every spec under `e2e/` and deals them
 * into CI's shards.
 *
 * One worker and no parallelism: the walk signs in once per staff role and
 * reuses that session across every surface that role visits, which two workers
 * would each have to pay again.
 *
 * **`retries: 0` and nothing here ever fails on a finding.** A defect the walk
 * spots is data written to `persona-bots/findings.json`, not a red test — the
 * exit code is reserved for the harness itself breaking, which is what tells
 * `scripts/persona-bots.mjs` to file nothing at all.
 */
process.env.AUTH_SECRET ??= "diveday-e2e-secret";

export default defineConfig({
  testDir: ".",
  testMatch: /walk\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // A visit is a navigation, an axe scan and a handful of DOM reads against a
  // warm server; the first one also pays the one-time migrate and seed. The
  // ceiling only ever bounds a hung navigation, never a passing visit.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? ([["github"], ["line"]] as const) : ([["line"]] as const),
  outputDir: "../../test-results/persona-bots",
  use: {
    baseURL: PERSONA_BASE_URL,
    launchOptions: chromiumLaunchOptions(),
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
    timezoneId: "America/New_York",
    colorScheme: "light",
    screenshot: "off",
    // **No trace, deliberately.** A Playwright trace carries request and
    // response headers — `Authorization`, `Cookie` — DOM snapshots and a
    // screenshot per action, and this run's artifacts are uploaded to a public
    // repository where anyone can download them. None of that passes through
    // the finding pipeline that decides what this bot is allowed to publish;
    // it would bypass it entirely.
    //
    // What a trace would buy is a picture of the one thing that can fail a
    // test here, a visit whose tab went away twice — and the run log already
    // names that surface and the error, which is what a reader acts on. So the
    // walk's published evidence is exactly `persona-bots/findings.json` and the
    // screenshots the issues link to, and nothing else leaves the runner.
    trace: "off",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: e2eServerCommand(PERSONA_PORT),
    // The supervisor and `next start` resolve from the repository root; a
    // webServer's cwd defaults to this config's own directory.
    cwd: path.resolve(__dirname, "../.."),
    url: PERSONA_BASE_URL,
    env: { ...e2eServerEnv, PORT: String(PERSONA_PORT) },
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 60_000,
  },
});
