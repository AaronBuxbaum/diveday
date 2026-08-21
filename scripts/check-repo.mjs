#!/usr/bin/env node
// Runs the repo safeguard checks concurrently and reports every failure in one pass.
//
// This replaces a serial `pnpm check:x && pnpm check:y && ...` chain: that form pays a
// pnpm-plus-node startup per check and stops at the first failure, hiding any later
// failures a session would otherwise want to see and fix in the same pass. This script
// spawns `node scripts/check-*.mjs` directly (skipping the pnpm wrapper), waits for all
// of them, and prints a clean per-check block for each — success line or full failure
// output — then exits non-zero if any check failed.
//
// Does not modify any of the underlying check-*.mjs scripts; it only spawns them.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Every check below is a static/lint-style pass over the repo, not a network call or a
// build — none has ever legitimately needed more than a few seconds. Bounding each one
// means a single stuck check (a git subprocess wedged on a lock, a runaway glob) turns
// into a loud, specific failure within this many seconds instead of hanging the whole
// `pnpm check` — and everything that shells out to it — forever with no diagnosis.
const CHECK_TIMEOUT_MS = 90_000;

// label -> script path (relative to this file's directory)
const checks = [
  ["env", "check-env.mjs"],
  ["architecture", "check-architecture.mjs"],
  ["tokens", "check-tokens.mjs"],
  ["clock", "check-clock.mjs"],
  ["db-concurrency", "check-db-concurrency.mjs"],
  ["intl-cache", "check-intl-cache.mjs"],
  ["adrs", "check-adrs.mjs"],
  ["docs", "check-doc-links.mjs"],
  ["agents", "check-agents.mjs"],
  ["follow-ups", "check-follow-ups.mjs"],
  ["e2e-fixtures", "check-e2e-fixtures.mjs"],
  ["e2e-hygiene", "check-e2e-hygiene.mjs"],
  ["route-coverage", "check-route-coverage.mjs"],
  ["uuid-segments", "check-uuid-segments.mjs"],
  ["notice-codes", "check-notice-codes.mjs"],
  ["scroll-preservation", "check-scroll-preservation.mjs"],
  ["soft-delete", "check-soft-delete.mjs"],
  ["live-trips", "check-live-trips.mjs"],
  ["redirect-in-try", "check-redirect-in-try.mjs"],
  ["text", "check-source-text.mjs"],
  ["infra-ascii", "check-infra-ascii.mjs"],
  ["locale", "check-locale.mjs"],
  ["timezone", "check-timezone.mjs"],
  ["copy", "check-copy.mjs"],
  ["domain-strings", "check-domain-strings.mjs"],
  ["migrations", "check-migrations.mjs"],
  ["open-graph", "check-open-graph.mjs"],
];

function runCheck(label, scriptFile) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, scriptFile);
    // `detached: true` makes the child its own process-group leader, so a timeout can
    // kill the whole tree (e.g. a `git`/`spawnSync` grandchild a check shells out to) via
    // the negative-pid form below — killing just the immediate child would otherwise
    // leave a wedged grandchild running as an orphan, un-diagnosed and un-detected.
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, CHECK_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        label,
        scriptFile,
        code: timedOut ? 1 : code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: timedOut
          ? `check:${label} timed out after ${CHECK_TIMEOUT_MS / 1000}s and was killed (this check should never take this long — a subprocess it shells out to is likely wedged)\n${Buffer.concat(stderrChunks).toString("utf8").trim()}`.trim()
          : Buffer.concat(stderrChunks).toString("utf8").trim(),
      });
    });
  });
}

const results = await Promise.all(checks.map(([label, scriptFile]) => runCheck(label, scriptFile)));

let anyFailed = false;
for (const result of results) {
  const header = `check:${result.label} (${result.scriptFile})`;
  if (result.code === 0) {
    console.log(`== ${header}: ok ==`);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.log(result.stderr);
  } else {
    anyFailed = true;
    console.error(`== ${header}: FAILED (exit ${result.code}) ==`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
  }
}

if (anyFailed) {
  console.error("\ncheck:repo: one or more checks failed (see above)");
  process.exit(1);
}

console.log("\ncheck:repo: all checks passed");
