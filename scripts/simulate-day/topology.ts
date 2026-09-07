import path from "node:path";
import { E2E_BASE_PORT } from "../../e2e/servers";
import { E2E_WORKER_PORT_STRIDE } from "../../src/lib/e2e-port";

/**
 * Where and when the one-day simulation runs. Shared by its Playwright config
 * (which starts the server) and its spec (which drives it), so the two never
 * disagree about the port or the day.
 */

/**
 * The simulation's server sits at the *top* of this checkout's e2e port block
 * (`resolveE2EBasePort` hands each checkout a 64-port stride), so it can run
 * beside a focused `pnpm e2e` in the same checkout without a collision — the
 * fleet's workers count up from the bottom of the block and never reach it.
 */
export const SIMULATION_PORT = Number(
  process.env.SIMULATE_DAY_PORT || E2E_BASE_PORT + E2E_WORKER_PORT_STRIDE - 1,
);

export const SIMULATION_BASE_URL = `http://127.0.0.1:${SIMULATION_PORT}`;

/**
 * The instant the shop opens: 06:00 in the demo shop's own zone
 * (America/New_York, EDT in July), on the same calendar day the e2e fleet is
 * frozen to (`E2E_FROZEN_CLOCK`, `e2e/servers.ts`) so the seed reads the same
 * week. The seeded departure then sails at 11:00 — `demoTodayDepartureStart`
 * rounds five hours ahead up to the half hour — and the whole day fits inside
 * one shop day, which is what the closing block requires.
 */
export const SIMULATION_DAY_START = process.env.SIMULATE_DAY_START || "2026-07-21T10:00:00.000Z";

/** Where the screenshots and the transcript land (gitignored). */
export const SIMULATION_OUT_DIR = path.resolve(
  process.cwd(),
  process.env.SIMULATE_DAY_OUT || "simulation",
);

/**
 * The slug the simulated shop is minted under. Pinned, like a visual capture's
 * shop, so the screenshots read the same on every run rather than carrying a
 * random name through the staff chrome.
 */
export const SIMULATION_SHOP_SLUG = "simulated-day";
