#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * `pnpm personas` — walk each of the fifteen personas through their own
 * surfaces against a real built server and write down what they find (N-61).
 *
 * What it does, in order:
 *
 * 1. Checks a Chromium is available (`scripts/ensure-playwright-browser.ts`).
 * 2. Builds the e2e production build — or, with `--no-build`, verifies one is
 *    already on disk (`scripts/check-e2e-build.mjs`), which is what the weekly
 *    workflow does after its own `pnpm e2e:build`.
 * 3. Empties `personas/` (keep it with `--keep`).
 * 4. Walks: `scripts/persona-bots/walk.spec.ts` under its own config, against
 *    one of the fleet's worker servers on the frozen clock.
 *
 * **It reports; it does not gate.** The walk records what it cannot reach
 * rather than failing on it, so a non-zero exit here means the harness broke,
 * never that a persona found something. Filing what it found is a separate
 * step (`scripts/persona-bots-file.mjs`, `pnpm personas:file`) that needs a
 * GitHub token, so the walk itself can be run by anyone, any time, without one.
 *
 * Options: `--no-build`, `--keep`, `--out <dir>` (default `personas`),
 * `--persona <id>` (walk one of them; the ids are in
 * `scripts/persona-bots/personas.mjs`).
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const outDir = path.resolve(
  process.cwd(),
  option("--out") ?? process.env.PERSONA_BOTS_OUT ?? "personas",
);
const env = { ...process.env, PERSONA_BOTS_OUT: outDir };
if (option("--persona")) env.PERSONA_BOTS_ONLY = option("--persona");

// Every call goes through `runBounded` rather than a bare synchronous spawn:
// this script is started by a weekly workflow nobody is watching, and an
// unbounded call is the exact shape `scripts/subprocess.test.mjs` refuses.
function run(command, commandArgs, label, timeoutMs) {
  const result = runBounded(command, commandArgs, {
    timeoutMs,
    stdio: "inherit",
    env,
    cwd: process.cwd(),
  });
  if (result.error) {
    console.error(`personas: could not start ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`personas: ${label} failed (exit ${result.status ?? "signal"})`);
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
  `personas: walking; findings land in ${path.relative(process.cwd(), outDir) || "."}/findings.json`,
);
const walk = runBounded(
  pnpm,
  ["exec", "playwright", "test", "--config", "scripts/persona-bots/playwright.config.ts"],
  {
    timeoutMs: SUBPROCESS_TIMEOUTS.personaWalk,
    stdio: "inherit",
    env,
    cwd: process.cwd(),
  },
);

const findings = path.join(outDir, "findings.json");
if (existsSync(findings)) {
  console.log(`personas: findings at ${path.relative(process.cwd(), findings)}`);
}
if (walk.status !== 0) {
  console.error(
    "personas: the walk itself broke — this is a harness failure, not a finding. Read the runner output above.",
  );
}
process.exit(walk.status ?? 1);
