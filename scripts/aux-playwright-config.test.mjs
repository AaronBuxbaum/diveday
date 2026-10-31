import { describe, expect, it } from "vitest";
import { chromiumLaunchOptions } from "../e2e/browser.ts";
import { E2E_TEST_ROUTE_SECRET, e2eServerCommand } from "../e2e/servers.ts";
import { e2eServerEnv } from "../playwright.config.ts";
import personaConfig from "./persona-bots/playwright.config.ts";
import { PERSONA_BASE_URL, PERSONA_PORT } from "./persona-bots/topology.ts";
import simulationConfig from "./simulate-day/playwright.config.ts";
import {
  SIMULATION_BASE_URL,
  SIMULATION_DAY_START,
  SIMULATION_PORT,
} from "./simulate-day/topology.ts";

const root = process.cwd();

function expectAuxiliaryConfig(
  config,
  { baseURL, port, testPattern, outputDir, timeout, viewport, serverEnv = {} },
) {
  expect(config.testDir).toBe(".");
  expect(config.testMatch).toEqual(testPattern);
  expect(config.testMatch.test("walk.spec.mts") || config.testMatch.test("day.spec.ts")).toBe(true);
  expect(config.fullyParallel).toBe(false);
  expect(config.workers).toBe(1);
  expect(config.retries).toBe(0);
  expect(config.timeout).toBe(timeout);
  expect(config.expect).toEqual({ timeout: 15_000 });
  expect(config.forbidOnly).toBe(Boolean(process.env.CI));
  expect(config.reporter).toEqual(process.env.CI ? [["github"], ["line"]] : [["line"]]);
  expect(config.outputDir).toBe(outputDir);
  expect(config.use).toMatchObject({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
    timezoneId: "America/New_York",
    colorScheme: "light",
    viewport,
  });
  expect(config.use.launchOptions).toEqual(chromiumLaunchOptions());

  expect(config.webServer.command).toBe(e2eServerCommand(port));
  expect(config.webServer.cwd).toBe(root);
  expect(config.webServer.url).toBe(baseURL);
  expect(config.webServer.reuseExistingServer).toBe(false);
  expect(config.webServer.stdout).toBe("ignore");
  expect(config.webServer.stderr).toBe("pipe");
  expect(config.webServer.timeout).toBe(60_000);
  for (const [name, value] of Object.entries({
    ...e2eServerEnv,
    ...serverEnv,
    PORT: String(port),
  })) {
    expect(config.webServer.env[name] === value, `server env preserves ${name}`).toBe(true);
  }
}

describe("auxiliary Playwright configs", () => {
  it("keeps the persona walk single-worker and prevents trace or screenshot publication", () => {
    expectAuxiliaryConfig(personaConfig, {
      baseURL: PERSONA_BASE_URL,
      port: PERSONA_PORT,
      testPattern: /walk\.spec\.mts$/,
      outputDir: "../../test-results/persona-bots",
      timeout: 120_000,
      viewport: { width: 1280, height: 900 },
    });
    expect(personaConfig.testMatch.test("walk.spec.mts")).toBe(true);
    expect(personaConfig.testMatch.test("walk.spec.ts")).toBe(false);
    expect(personaConfig.testMatch.test("day.spec.ts")).toBe(false);
    expect(personaConfig.use.screenshot).toBe("off");
    expect(personaConfig.use.trace).toBe("off");
  });

  it("keeps the simulation clock and failure evidence separate", () => {
    expectAuxiliaryConfig(simulationConfig, {
      baseURL: SIMULATION_BASE_URL,
      port: SIMULATION_PORT,
      testPattern: /day\.spec\.ts$/,
      outputDir: "../../test-results/simulate-day",
      timeout: 180_000,
      viewport: { width: 1279, height: 720 },
      serverEnv: { DIVEDAY_CLOCK: SIMULATION_DAY_START },
    });
    expect(simulationConfig.testMatch.test("day.spec.ts")).toBe(true);
    expect(simulationConfig.testMatch.test("walk.spec.mts")).toBe(false);
    expect(simulationConfig.use.screenshot).toBe("only-on-failure");
    expect(simulationConfig.use.trace).toBe("retain-on-failure");
    expect(simulationConfig.webServer.env.DIVEDAY_CLOCK).toBe(SIMULATION_DAY_START);
  });
});
