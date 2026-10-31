import { auxiliaryPlaywrightConfig } from "../aux-playwright-config";
import { PERSONA_BASE_URL, PERSONA_PORT } from "./topology";

/**
 * The weekly persona walk's own runner config (`pnpm persona:bots`).
 *
 * This run stays outside the pull-request E2E fleet because the fleet discovers
 * every spec under `e2e/` and deals them into CI shards. It reuses one owner
 * session across the walk, so it is deliberately serial and single-worker.
 * Findings are data rather than test failures; only a broken harness fails.
 *
 * Artifacts are uploaded to a public repository. Trace is explicitly off:
 * traces include authorization and cookie headers, DOM snapshots and action
 * screenshots, and would bypass the finding pipeline's publication controls.
 */
export default auxiliaryPlaywrightConfig({
  baseURL: PERSONA_BASE_URL,
  port: PERSONA_PORT,
  outputDir: "../../test-results/persona-bots",
  testMatch: /walk\.spec\.mts$/,
  // Visits use a warm server; the first also pays for migrate and seed. This
  // finite ceiling only bounds a hung navigation.
  timeout: 120_000,
  screenshot: "off",
  trace: "off",
  viewport: { width: 1280, height: 900 },
});
