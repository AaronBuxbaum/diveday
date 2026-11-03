/**
 * The harness's one hand on the server's clock, shared by `/api/test/clock`
 * (moves it forward) and `/api/test/reset` (puts it back).
 *
 * The clock is a fact of the fixture like any row: whoever moves it names the
 * instant, and the reset restores the instant the server booted frozen at, the
 * same way it puts every row back (issue #2761). Only the reset may move it
 * backwards; `/api/test/clock` refuses to.
 *
 * The boot instant is kept in `DIVEDAY_CLOCK_BOOT`, written the first time the
 * clock moves, rather than in a module variable: each route is its own bundle,
 * and a copy of this module loaded after the first move would remember the
 * moved instant as the boot one.
 *
 * `src/lib/clock.ts` still refuses the override whenever a real `DATABASE_URL`
 * is set, so nothing here can freeze a deployment.
 */

type Env = Record<string, string | undefined>;

const BOOT_KEY = "DIVEDAY_CLOCK_BOOT";

/** Point the server's clock at `instant`, remembering where it booted. */
export function moveServerClock(instant: Date, env: Env = process.env): void {
  if (env[BOOT_KEY] === undefined) env[BOOT_KEY] = env.DIVEDAY_CLOCK ?? "";
  env.DIVEDAY_CLOCK = instant.toISOString();
}

/** Put the clock back where the server booted; true when it had moved. */
export function restoreBootClock(env: Env = process.env): boolean {
  const boot = env[BOOT_KEY];
  if (boot === undefined) return false;
  if (boot === "") delete env.DIVEDAY_CLOCK;
  else env.DIVEDAY_CLOCK = boot;
  delete env[BOOT_KEY];
  return true;
}
