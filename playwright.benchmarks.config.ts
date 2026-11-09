import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Separate, no-pixel-baseline lane. It uses the exact isolation/auth/clock fleet.
export default defineConfig(base, {
  testDir: "./benchmarks",
  testMatch: "*.spec.ts",
  // Four intentionally throttled navigations per measurement, not an ordinary flow budget.
  // This lane reports timings; the functional/visual suite keeps its existing budgets.
  timeout: 90_000,
  outputDir: "benchmark-results",
  reporter: [["list"], ["json", { outputFile: "benchmark-results/results.json" }]],
});
