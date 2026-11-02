#!/usr/bin/env node
// A CI warning, never a failure: a pull request changes logic under src/lib, src/db or
// src/features and changes no test file (code review 2026-10-29, finding 6). "Tests travel with
// behavior" (AGENTS.md) was a rule nothing read; this puts the question on the check run, where
// the `::warning` annotations of scripts/e2e-budget-report.mjs are already read.
//
// Logic is a non-test `.ts` file added or modified there; a rename or a pure deletion is not a
// change to behavior and does not count. A test is any `*.test.*` file anywhere in the diff.
// It cannot tell whether the test covers the change, so it is a prompt, not a verdict.
//
//   node scripts/warn-untested-logic.mjs [--base <ref>]     (default origin/main, three-dot)

import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const LOGIC = /^src\/(lib|db|features)\/.+\.ts$/;
const NOT_LOGIC = [/\.d\.ts$/, /\.test\.[^/]+$/, /\.test-support\.ts$/];
const TEST = /\.test\.[^/]+$/;
const LISTED = 10;

/** `git diff --name-status -M` output as `{ status, path }`; a rename's path is its new name. */
export function parseNameStatus(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status: status[0], path: paths.at(-1) };
    });
}

/** The `::warning` line for these changes, or null when there is nothing to say. */
export function untestedLogicWarning(changes) {
  if (changes.some((change) => TEST.test(change.path))) return null;
  const logic = changes
    .filter((change) => change.status === "A" || change.status === "M")
    .map((change) => change.path)
    .filter((file) => LOGIC.test(file) && !NOT_LOGIC.some((re) => re.test(file)));
  if (logic.length === 0) return null;
  const shown = logic.slice(0, LISTED).join(", ");
  const more = logic.length > LISTED ? ` and ${logic.length - LISTED} more` : "";
  return `::warning title=Logic changed with no test::${logic.length} non-test file(s) under src/lib, src/db or src/features changed and no *.test.* file did: ${shown}${more}. Add or extend the test that fails without this change, or say in the PR body why none applies.`;
}

function main() {
  const flag = process.argv.indexOf("--base");
  const base = flag === -1 ? "origin/main" : process.argv[flag + 1];
  const output = readBounded("git", ["diff", "--name-status", "-M", `${base}...HEAD`], {
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  const warning = untestedLogicWarning(parseNameStatus(String(output)));
  if (warning) console.log(warning);
  return 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
