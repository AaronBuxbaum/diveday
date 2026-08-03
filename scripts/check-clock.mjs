import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Domain and data code must read the current time through src/lib/clock.ts
 * (`nowDate()` / `nowMs()`), never a bare `new Date()` / `Date.now()`.
 *
 * Why this is a guarded invariant, not a style nit: the demo seed is
 * clock-anchored and dozens of surfaces render relative time, so a direct call
 * to the live wall clock in src/lib or src/db is exactly what makes visual
 * baselines drift every run (a departure's slot advances, the Today
 * queue reorders, a date rolls at midnight). The clock module is the single
 * seam the e2e fleet freezes (DIVEDAY_CLOCK); anything that bypasses it can't
 * be frozen, so the freeze silently develops holes. In production the module
 * is `new Date()` / `Date.now()` byte for byte, so routing through it costs
 * nothing there.
 *
 * Scope is src/lib, src/db, and src/features — the framework-free domain, the
 * data layer, and the feature modules that compose them (docs ADR
 * 20260730-feature-module-contracts), where seed and query time originate.
 * src/app is intentionally out of scope:
 * client components legitimately read the browser clock (which the e2e specs
 * freeze with page.clock instead), so a blanket ban there would fire on
 * genuinely-live UI. Server components under src/app should still thread time
 * from the clock; that is a review expectation, not a machine-checked one.
 *
 * ## Why the tests in those roots are in scope too
 *
 * Test files under the guarded roots used to be skipped wholesale, and dozens
 * of them drifted into a hidden dependency on *real* time running ahead of the
 * frozen instant. The shapes were always the same:
 *
 * - `listPendingMediaDeletions(db, shopId, new Date(Date.now() + 1000))` — an
 *   upper bound meaning "everything due by now". The rows it is bounding were
 *   written at the frozen instant, so this only selects them while the wall
 *   clock is *later* than the freeze.
 * - `startsAt: new Date(Date.now() + OFFSET)` — a session placed relative to
 *   real time, then read back by a query anchored at `nowMs()`. The two only
 *   agree on which side of "now" the row falls while the same inequality holds.
 *
 * Both invert the day the frozen instant is moved forward past the wall clock,
 * and they fail as a confusing mass rather than at the one seam that moved. A
 * test that means "the application's now" says `nowMs()`; a test that genuinely
 * means the wall clock is listed below with its reason.
 */

const ROOT = process.cwd();
const guardedRoots = ["src/lib", "src/db", "src/features"];
const sourceExtensions = new Set([".ts", ".tsx"]);
// The clock module is the one place production code reads the real wall clock.
const allowed = new Set([path.normalize("src/lib/clock.ts")]);
/**
 * Test files that legitimately read the wall clock, each with the reason. A
 * new entry needs a reason a reader can check — "it was easier" is not one.
 */
const allowedTests = new Map([
  [
    path.normalize("src/lib/clock.test.ts"),
    "tests the live-clock path itself — bracketing nowMs() between two real Date.now() readings is the assertion",
  ],
]);
// Argless `new Date()` and `Date.now()` only — `new Date(startsAt)` and other
// parameterised parses are fine.
const clockPattern = /\bnew Date\(\s*\)|\bDate\.now\(\s*\)/g;

const isTestFile = (file) => /\.test\.tsx?$/.test(file);

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

const violations = [];
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    const normalized = path.normalize(file);
    if (allowed.has(normalized)) continue;
    if (isTestFile(file) && allowedTests.has(normalized)) continue;
    const contents = await readFile(path.join(ROOT, file), "utf8");
    const lines = contents.split("\n");
    lines.forEach((line, index) => {
      if (clockPattern.test(line)) violations.push(`${file}:${index + 1}: ${line.trim()}`);
      clockPattern.lastIndex = 0;
    });
  }
}

if (violations.length > 0) {
  console.error(
    `Direct wall-clock reads in domain/data code:\n${violations.map((v) => `- ${v}`).join("\n")}`,
  );
  console.error(
    "Read time through src/lib/clock.ts (`nowDate()` / `nowMs()`) so the e2e clock freeze can stabilise it. In production the clock is `new Date()` / `Date.now()` unchanged.",
  );
  console.error(
    "In a test this also stops the assertion depending on real time running ahead of the frozen instant. If the file genuinely means the wall clock, add it to `allowedTests` in this script with the reason.",
  );
  process.exit(1);
}

console.log("clock: domain/data time reads — tests included — route through src/lib/clock.ts");
