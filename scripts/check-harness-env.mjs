import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Product code asks `runtimeMode()` (src/lib/runtime-mode.ts) whether it is
 * running under the e2e harness; only that file knows how the harness is
 * switched on (issue #2781). `DIVEDAY_E2E` and `DIVEDAY_CLOCK` read anywhere
 * else in `src/` fail here, so the 11 files that each spelled their own
 * `DATABASE_URL` / `NODE_ENV` / `DIVEDAY_E2E` predicate do not grow back.
 *
 * `REMAINING` is a ratchet, not a permission: each file still reads a variable
 * directly and moves onto the seam under the same issue. An entry whose file no
 * longer reads one fails too, so the list only shrinks.
 */
const ROOT = process.cwd();
const IS_TEST = /\.test\.tsx?$|^src\/test\//;
const HARNESS = /\b(?:process\.)?env(?:\.|\[["'])(DIVEDAY_E2E|DIVEDAY_CLOCK)\b(?!_)/;
const SEAM = "src/lib/runtime-mode.ts";

const REMAINING = new Set([
  "src/app/api/test/clock/route.ts", // writes the clock, the one place that sets it
  "src/app/api/test/seed-trouble-states/auth-state.ts",
  "src/app/sign-in/page.tsx",
  "src/proxy.ts", // the dev-only CSP relaxation
  "src/lib/observability/query-timing.ts",
  "src/lib/pending-sign-in.ts",
  "src/lib/assists/e2e-fixtures.ts",
]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(path.join(ROOT, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relative)));
    else if (/\.tsx?$/.test(entry.name)) files.push(relative);
  }
  return files;
}

/** The 1-based line of the first harness-variable read in `source`, or null. */
export function harnessReadLine(source) {
  const lines = source.split("\n");
  const index = lines.findIndex((line) => !/^\s*(\*|\/\/)/.test(line) && HARNESS.test(line));
  return index === -1 ? null : index + 1;
}

async function main() {
  const violations = [];
  const reading = new Set();
  for (const file of await walk("src")) {
    if (IS_TEST.test(file) || file === SEAM) continue;
    const line = harnessReadLine(await readFile(path.join(ROOT, file), "utf8"));
    if (line === null) continue;
    reading.add(file);
    if (!REMAINING.has(file)) violations.push(`${file}:${line}`);
  }
  const stale = [...REMAINING].filter((file) => !reading.has(file));
  if (violations.length > 0) {
    console.error(
      `DIVEDAY_E2E / DIVEDAY_CLOCK read outside src/lib/runtime-mode.ts:\n${violations.map((v) => `- ${v}`).join("\n")}\nAdd a field to runtimeMode() and read that.`,
    );
  }
  if (stale.length > 0) {
    console.error(
      `REMAINING in scripts/check-harness-env.mjs names files that no longer read a harness variable: ${stale.join(", ")}. Remove them.`,
    );
  }
  if (violations.length > 0 || stale.length > 0) process.exit(1);
  console.log(
    `harness-env: ${reading.size} files still read a harness variable directly, all listed`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
