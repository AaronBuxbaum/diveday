import { auxiliaryPlaywrightConfig } from "../aux-playwright-config";
import { SIMULATION_BASE_URL, SIMULATION_DAY_START, SIMULATION_PORT } from "./topology";

/**
 * The one-day simulation's own runner config (`pnpm simulate:day`).
 *
 * The simulation stays outside `e2e/`: it takes minutes, owns and advances its
 * clock through `/api/test/clock`, and belongs to a nightly job rather than the
 * pull-request gate. One server, browser and ordered spec share this clock.
 */
export default auxiliaryPlaywrightConfig({
  baseURL: SIMULATION_BASE_URL,
  port: SIMULATION_PORT,
  outputDir: "../../test-results/simulate-day",
  testMatch: /day\.spec\.ts$/,
  // A state includes several writes and the first includes migrate + seed; the
  // transcript records duration while this finite ceiling bounds a hung step.
  timeout: 180_000,
  screenshot: "only-on-failure",
  trace: "retain-on-failure",
  viewport: { width: 1279, height: 720 },
  serverEnv: { DIVEDAY_CLOCK: SIMULATION_DAY_START },
});
