import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { chromiumLaunchOptions } from "../e2e/browser";
import { E2E_TEST_ROUTE_SECRET, e2eServerCommand } from "../e2e/servers";
import { e2eServerEnv } from "../playwright.config";

/** Settings that belong to one auxiliary run and must stay visible at its call site. */
export interface AuxPlaywrightConfigOptions {
  baseURL: string;
  port: number;
  outputDir: string;
  testMatch: RegExp;
  timeout: number;
  viewport: { width: number; height: number };
  screenshot: "off" | "only-on-failure";
  trace: "off" | "retain-on-failure";
  serverEnv?: Readonly<Record<string, string | undefined>>;
}

/** Shared harness wiring for standalone, serial E2E runs. */
export function auxiliaryPlaywrightConfig(options: AuxPlaywrightConfigOptions) {
  process.env.AUTH_SECRET ??= "diveday-e2e-secret";

  return defineConfig({
    testDir: ".",
    testMatch: options.testMatch,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: !!process.env.CI,
    timeout: options.timeout,
    expect: { timeout: 15_000 },
    reporter: process.env.CI ? ([["github"], ["line"]] as const) : ([["line"]] as const),
    outputDir: options.outputDir,
    use: {
      baseURL: options.baseURL,
      launchOptions: chromiumLaunchOptions(),
      extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
      timezoneId: "America/New_York",
      colorScheme: "light",
      screenshot: options.screenshot,
      trace: options.trace,
      ...devices["Desktop Chrome"],
      viewport: options.viewport,
    },
    webServer: {
      command: e2eServerCommand(options.port),
      cwd: path.resolve(__dirname, ".."),
      url: options.baseURL,
      env: { ...e2eServerEnv, ...options.serverEnv, PORT: String(options.port) },
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      timeout: 60_000,
    },
  });
}
