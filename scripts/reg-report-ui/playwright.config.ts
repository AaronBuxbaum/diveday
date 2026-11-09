import { defineConfig } from "@playwright/test";
import { chromiumLaunchOptions } from "../../e2e/browser";

// This tests the report generator, not the app: no Next build, database, AWS,
// publication or web server. The spec serves only its generated fixture files.
export default defineConfig({
  testDir: ".",
  testMatch: "report.spec.mts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: "../../test-results/reg-report-ui",
  reporter: [
    ["line"],
    // CI's existing failure upload collects this report and its trace/PNG data.
    ["html", { outputFolder: "../../playwright-report/reg-report-ui", open: "never" }],
  ],
  use: {
    browserName: "chromium",
    launchOptions: chromiumLaunchOptions(),
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
