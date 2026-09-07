#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * `pnpm simulate:day` — rehearse one whole dive day against a real built
 * server with the frozen clock advancing (N-60; the machine's version of the
 * V-04 rehearsal).
 *
 * What it does, in order:
 *
 * 1. Checks a Chromium is available (`scripts/ensure-playwright-browser.ts`).
 * 2. Builds the e2e production build — or, with `--no-build`, verifies one is
 *    already on disk (`scripts/check-e2e-build.mjs`), which is what the nightly
 *    workflow does after its own `pnpm e2e:build`.
 * 3. Empties `simulation/` (keep it with `--keep`).
 * 4. Runs the day: `scripts/simulate-day/day.spec.ts` under
 *    `scripts/simulate-day/playwright.config.ts`, which starts one of the
 *    fleet's worker servers at six in the morning and drives it to the recap.
 *
 * Exit status is the runner's: non-zero on the first state the day cannot
 * reach. Either way `simulation/day.md` says what was reached and when, and a
 * screenshot per state sits beside it.
 *
 * Options: `--no-build`, `--keep`, `--out <dir>` (default `simulation`),
 * `--start <iso>` (the instant the shop opens; default in
 * `scripts/simulate-day/topology.ts`).
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const outDir = path.resolve(
  process.cwd(),
  option("--out") ?? process.env.SIMULATE_DAY_OUT ?? "simulation",
);
const env = { ...process.env, SIMULATE_DAY_OUT: outDir };
if (option("--start")) env.SIMULATE_DAY_START = option("--start");

// Every call below goes through `runBounded` rather than a bare synchronous
// spawn: this script is started by a nightly workflow nobody is watching, and
// an unbounded call is the exact shape `scripts/subprocess.test.mjs` refuses.
function run(command, commandArgs, label, timeoutMs) {
  const result = runBounded(command, commandArgs, {
    timeoutMs,
    stdio: "inherit",
    env,
    cwd: process.cwd(),
  });
  if (result.error) {
    console.error(`simulate-day: could not start ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`simulate-day: ${label} failed (exit ${result.status ?? "signal"})`);
    process.exit(result.status ?? 1);
  }
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// `build`'s ceiling, not a tighter one: a cold machine downloads a Chromium here.
run(pnpm, ["e2e:browser-check"], "the browser check", SUBPROCESS_TIMEOUTS.build);

if (flag("--no-build")) {
  run(
    process.execPath,
    ["scripts/check-e2e-build.mjs"],
    "the build check",
    SUBPROCESS_TIMEOUTS.nodeScript,
  );
} else {
  run(pnpm, ["e2e:build"], "the e2e build", SUBPROCESS_TIMEOUTS.build);
}

if (!flag("--keep") && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(
  `simulate-day: driving the day; artifacts land in ${path.relative(process.cwd(), outDir) || "."}`,
);
const runner = runBounded(
  pnpm,
  ["exec", "playwright", "test", "--config", "scripts/simulate-day/playwright.config.ts"],
  {
    timeoutMs: SUBPROCESS_TIMEOUTS.simulateDay,
    stdio: "inherit",
    env,
    cwd: process.cwd(),
  },
);

const transcript = path.join(outDir, "day.md");
if (existsSync(transcript)) {
  console.log(`simulate-day: transcript at ${path.relative(process.cwd(), transcript)}`);
}
if (runner.status !== 0) {
  console.error(
    "simulate-day: the day did not reach every state — read the transcript for the first one it could not.",
  );
}
process.exit(runner.status ?? 1);
