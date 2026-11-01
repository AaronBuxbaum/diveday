#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { SAFETY_FILES } from "./coverage-safety-files.mjs";

/**
 * Which changed paths can move the branch coverage of the safety files, so ci.yml's `changes` job
 * can skip the v8 collector in the four unit shards and the `coverage-floors` job on a pull
 * request that touched none of them. A push to main always runs both (the backstop for a test
 * deleted somewhere this list does not look).
 *
 * Reads changed paths on stdin, one per line; prints the relevant ones.
 */

/** A safety file and its siblings: `readiness.ts` -> `readiness.test.ts`, `readiness.*.test.ts`. */
const SAFETY_STEMS = SAFETY_FILES.map((file) => file.replace(/\.[cm]?[jt]sx?$/, ""));

/** Config and harness that decide what is measured or how the tests run. */
const SHARED = [
  /^vitest\.config\./,
  /^src\/test\//,
  /^scripts\/coverage-/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^\.github\/actions\/setup\//,
];

export function coverageRelevant(file) {
  if (SHARED.some((pattern) => pattern.test(file))) return true;
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file);
  return SAFETY_STEMS.some((stem) => {
    if (path.posix.dirname(stem) !== dir) return false;
    const name = path.posix.basename(stem);
    return base === `${name}.ts` || base.startsWith(`${name}.`) || base.startsWith(`${name}-`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = readFileSync(0, "utf8").split("\n").filter(Boolean);
  for (const line of lines.filter(coverageRelevant)) console.log(line);
}
