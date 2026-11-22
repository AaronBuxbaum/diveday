// Which test files run for a mutant (ADR 20261122-diff-mutation-testing): the tests that name
// the module. A test names it when one of its import specifiers resolves to the file (relative,
// the `@/` alias, with or without an extension), directly or through a door that only
// re-exports it, plus the colocated `<name>.test.*` and `<name>.*.test.*` siblings. Direct
// importers only, never transitive: a readiness change would otherwise run most of the suite.
//
// A hub is a module more test files name than a run can finish (`src/db/bookings.ts`: 239, of
// which 231 open a database). Its unbroken baseline alone outran its five minutes on CI, and a
// break run against all of them would hit the per-break ceiling and be counted as caught without
// one assertion failing. Past `HUB_TEST_LIMIT` importers, the tests named after the module
// (`bookings.test.ts`, `bookings-capacity.test.ts`) are the whole selection, when it has any.
// `src/lib/readiness.ts` sits nearest the limit (about 40 importers, about 15 named tests); the
// run prints a line whenever a module is narrowed, so the day it crosses is seen.
//
// Never selected: `*.postgres.test.*` (they need a server), the source-text `guards` project
// (it reads files, it does not run the module) and this directory's own tests.

import { globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { classifyTestFile } from "../../src/test/projects.ts";
import { isReexportOnlyContract } from "../coverage-safety-files.mjs";

/** More importing test files than this, and a module is drilled against the tests named after it. */
export const HUB_TEST_LIMIT = 40;

const TEST_GLOBS = [
  "src/**/*.test.{ts,tsx,mts}",
  "scripts/**/*.test.{ts,mjs}",
  "infra/**/*.test.ts",
];

/** Static `import`/`export … from`, bare `import "x"` and dynamic `import("x")`, not type-only. */
const SPECIFIERS =
  /(?:^|[\n;])\s*(import|export)(\s+type\b)?[^;'"]*?\bfrom\s*["']([^"']+)["']|(?:^|[\n;])\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.tsx"];

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The repository path a specifier names from `fromFile`, or `null` (a package, or missing). */
export function resolveSpecifier(root, fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = path.join("src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.join(path.dirname(fromFile), specifier);
  else return null;
  const stripped = base.replace(/\.js$/, "");
  for (const candidate of [base, ...EXTENSIONS.map((ext) => stripped + ext)]) {
    if (isFile(path.join(root, candidate))) return candidate.split(path.sep).join("/");
  }
  return null;
}

/** The runtime (not type-only) specifiers in one source. */
export function runtimeSpecifiers(source) {
  const found = [];
  for (const match of source.matchAll(SPECIFIERS)) {
    if (match[2]) continue;
    found.push(match[3] ?? match[4] ?? match[5]);
  }
  return found;
}

/**
 * Everything a test file reaches through its own specifiers, following a door that only
 * re-exports (`index.ts` of a feature concept) to the files behind it.
 */
function reachedFiles(root, testFile, source, doors) {
  const reached = new Set();
  const visit = (from, specifier, depth) => {
    const file = resolveSpecifier(root, from, specifier);
    if (!file || reached.has(file)) return;
    reached.add(file);
    if (depth > 4 || !/\.tsx?$/.test(file)) return;
    let behind = doors.get(file);
    if (behind === undefined) {
      const text = readFileSync(path.join(root, file), "utf8");
      behind = isReexportOnlyContract(text) ? runtimeSpecifiers(text) : [];
      doors.set(file, behind);
    }
    for (const next of behind) visit(file, next, depth + 1);
  };
  for (const specifier of runtimeSpecifiers(source)) visit(testFile, specifier, 0);
  return reached;
}

/**
 * One pass over every test file in the repository, done once per run: returns
 * `select(target) → { files, db, near }`, where `db` lists the selected files that hydrate a
 * database (they get the longer per-mutant ceiling and run last) and `near` the pure ones
 * named after the module (they run first).
 */
export function buildTestIndex(root) {
  const tests = [
    ...new Set(
      TEST_GLOBS.flatMap((glob) =>
        globSync(glob, { cwd: root, exclude: (f) => f.includes("node_modules") }),
      ),
    ),
  ]
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => !/\.postgres\.test\./.test(file))
    .filter((file) => !/^scripts\/mutation\/[^/]+\.test\.mjs$/.test(file))
    .sort();
  const doors = new Map();
  const entries = [];
  for (const file of tests) {
    const source = readFileSync(path.join(root, file), "utf8");
    const project = classifyTestFile(file, source);
    if (project === "guards") continue;
    entries.push({
      file,
      db: project === "db" || project === "dbShared",
      reached: reachedFiles(root, file, source, doors),
    });
  }
  return function select(target) {
    const dir = path.posix.dirname(target);
    const name = path.posix.basename(target).replace(/\.[cm]?[jt]sx?$/, "");
    const sibling = (file) => {
      if (path.posix.dirname(file) !== dir) return false;
      const base = path.posix.basename(file);
      return base.startsWith(`${name}.`) && /\.test\.[cm]?[jt]sx?$/.test(base);
    };
    const importers = entries.filter((entry) => entry.reached.has(target) || sibling(entry.file));
    // The tests named after the module (`readiness.test.ts`, `readiness-edges.test.ts`) are the
    // likeliest to catch a break, so the runner tries them first.
    const near = (file) =>
      path.posix.dirname(file) === dir &&
      /^[.-]/.test(path.posix.basename(file).slice(name.length)) &&
      path.posix.basename(file).startsWith(name);
    const named = importers.filter((entry) => near(entry.file));
    const narrowed = importers.length > HUB_TEST_LIMIT && named.length > 0;
    const chosen = narrowed ? named : importers;
    return {
      // How many test files name a hub, when only the ones named after it run: the run says so.
      narrowedFrom: narrowed ? importers.length : undefined,
      files: chosen.map((entry) => entry.file),
      db: chosen.filter((entry) => entry.db).map((entry) => entry.file),
      near: chosen.filter((entry) => !entry.db && near(entry.file)).map((entry) => entry.file),
    };
  };
}
