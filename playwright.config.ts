import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Sandboxed agent environments pre-install Chromium (often a different revision
// than this Playwright version expects) and block browser downloads. Prefer an
// explicit override, then the sandbox binary, then Playwright's own resolution.
const sandboxChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (!process.env.CI && fs.existsSync(sandboxChromium) ? sandboxChromium : undefined);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Dev-server-backed e2e: first hit on a route pays the compile cost.
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Calling Next directly avoids a package-manager preflight inside the
    // isolated test server, and an explicit loopback host avoids interface
    // discovery in constrained CI containers.
    command: "./node_modules/.bin/next dev --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    // Browser tests must never inherit a developer's production-like Neon URL
    // from .env.local. Give them an isolated, migration-backed local database.
    env: {
      ...process.env,
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      PGLITE_DATA_DIR: ".pglite-e2e",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
