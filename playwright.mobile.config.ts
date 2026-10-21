import { defineConfig, devices } from "@playwright/test";
import desktop from "./playwright.config";

// Reuse isolated databases, frozen clocks and sanitized providers. The default
// fleet keeps its Chromium-only screenshots and never discovers these tests.
export default defineConfig({
  ...desktop,
  testMatch: "**/mobile*.spec.ts",
  testIgnore: [],
  globalSetup: "./e2e/mobile-global-setup.ts",
  outputDir: "test-results/mobile",
  projects: [
    { name: "touch-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit", launchOptions: {} },
    },
  ],
});
