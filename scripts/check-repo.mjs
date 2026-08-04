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

// label -> script path (relative to this file's directory)
const checks = [
  ["env", "check-env.mjs"],
  ["architecture", "check-architecture.mjs"],
  ["tokens", "check-tokens.mjs"],
  ["clock", "check-clock.mjs"],
  ["adrs", "check-adrs.mjs"],
  ["docs", "check-doc-links.mjs"],
  ["agents", "check-agents.mjs"],
  ["e2e-fixtures", "check-e2e-fixtures.mjs"],
  ["route-coverage", "check-route-coverage.mjs"],
  ["text", "check-source-text.mjs"],
  ["locale", "check-locale.mjs"],
  ["copy", "check-copy.mjs"],
  ["domain-strings", "check-domain-strings.mjs"],
];

function runCheck(label, scriptFile) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, scriptFile);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      resolve({
        label,
        scriptFile,
        code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
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
