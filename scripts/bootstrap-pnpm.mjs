#!/usr/bin/env node
// Install only the repo's pinned package manager. Dependency installation and
// all later build/test commands remain outside this retry boundary.
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const transient = (output) =>
  /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b|npm (?:ERR!|error) (?:code )?(?:E5\d\d|5\d\d)\b/i.test(
    output,
  );
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function bootstrapPnpm({
  version,
  prefix,
  run = runBounded,
  log = console.log,
  sleep = sleepSync,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !prefix)
    throw new Error("Expected a pinned pnpm version and an install prefix");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    log(`pnpm bootstrap: attempt ${attempt}/3`);
    const result = run(
      "npm",
      [
        "install",
        "--global",
        "--ignore-scripts",
        "--fetch-retries=0",
        "--no-audit",
        "--no-fund",
        "--prefix",
        prefix,
        `pnpm@${version}`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: SUBPROCESS_TIMEOUTS.packageManagerBootstrap,
      },
    );
    const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
    if (output.trim()) log(output.trimEnd());
    if (result?.status === 0) return true;
    if (result?.error?.code === "ETIMEDOUT") log("pnpm bootstrap: npm timed out");
    if (attempt === 3 || (!transient(output) && result?.error?.code !== "ETIMEDOUT")) return false;
    sleep(attempt * 1000);
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { packageManager } = JSON.parse(readFileSync("package.json", "utf8"));
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager ?? "");
  if (!match || !process.env.RUNNER_TEMP)
    throw new Error("Expected package.json to pin pnpm and RUNNER_TEMP to be set");
  if (!bootstrapPnpm({ version: match[1], prefix: `${process.env.RUNNER_TEMP}/diveday-pnpm` }))
    process.exitCode = 1;
}
