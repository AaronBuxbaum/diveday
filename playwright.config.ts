import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { E2E_WORKER_COUNT, e2eBaseURL, e2ePort, e2eWorkerIndexes } from "./e2e/servers";

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
//   - SCUBA_E2E re-opens /api/test/reset, which is otherwise closed in a
//     production runtime (see src/app/api/test/reset/route.ts).
const serverEnv = {
  ...process.env,
  DATABASE_URL: "",
  DATABASE_URL_UNPOOLED: "",
  PGLITE_DATA_DIR: "memory",
  SCUBA_E2E: "1",
  AUTH_TRUST_HOST: "true",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "scuba-e2e-secret",
  // External providers are unit-tested through injected fetchers. Keeping them
  // out of the browser suite makes it deterministic without mocking our own
  // server or database.
  SCUBA_DISABLE_EXTERNAL_HTTP: "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: E2E_WORKER_COUNT,
  // Precompiled servers serve routes without the dev-mode first-hit compile, so
  // warm assertions settle in well under a second (most tests finish in 1-4s).
  // The headroom here is only for the one-time cold render of a heavy route the
  // warmup can't reach (dynamic [id] pages) under parallel CPU load — a ceiling,
  // not added latency.
  expect: { timeout: 20_000 },
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
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
      timeout: 120_000,
    };
  }),
});
