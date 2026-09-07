import path from "node:path";
import { E2E_BASE_PORT } from "../../e2e/servers";
import { E2E_WORKER_PORT_STRIDE } from "../../src/lib/e2e-port";

/**
 * Where the weekly persona walk runs (N-61). Shared by its Playwright config
 * (which starts the server) and its spec (which drives it), so the two never
 * disagree about the port or where the artifacts land.
 */

/**
 * One below the one-day simulation's port, which is itself the top of this
 * checkout's 64-port block (`resolveE2EBasePort`). The fleet's workers count up
 * from the bottom and never reach either, so a persona walk, a simulated day
 * and a focused `pnpm e2e` can all run in one checkout without colliding.
 */
export const PERSONA_PORT = Number(
  process.env.PERSONA_BOTS_PORT || E2E_BASE_PORT + E2E_WORKER_PORT_STRIDE - 2,
);

export const PERSONA_BASE_URL = `http://127.0.0.1:${PERSONA_PORT}`;

/** Where the findings file and the screenshots land (gitignored). */
export const PERSONA_OUT_DIR = path.resolve(
  process.cwd(),
  process.env.PERSONA_BOTS_OUT || "persona-bots",
);

/** The walk's own report, read back by `scripts/persona-bots.mjs`. */
export const PERSONA_FINDINGS_FILE = path.join(PERSONA_OUT_DIR, "findings.json");

/**
 * How many distinct surfaces the run photographs.
 *
 * Bounded because each capture is its own `scripts/screenshot.mjs` process
 * (one browser, one sign-in) and because an issue nobody can read past the
 * third picture is not better for the fourth. The routes chosen are the ones
 * behind the highest-ranked finding classes, which are the ones that can
 * actually be filed.
 */
export const SCREENSHOT_CAP = 8;
