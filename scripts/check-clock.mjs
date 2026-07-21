import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Domain and data code must read the current time through src/lib/clock.ts
 * (`nowDate()` / `nowMs()`), never a bare `new Date()` / `Date.now()`.
 *
 * Why this is a guarded invariant, not a style nit: the demo seed is
 * clock-anchored and dozens of surfaces render relative time, so a direct call
 * to the live wall clock in src/lib or src/db is exactly what makes Argos
 * visual baselines drift every run (a departure's slot advances, the Today
 * queue reorders, a date rolls at midnight). The clock module is the single
 * seam the e2e fleet freezes (DIVEDAY_CLOCK); anything that bypasses it can't
 * be frozen, so the freeze silently develops holes. In production the module
 * is `new Date()` / `Date.now()` byte for byte, so routing through it costs
 * nothing there.
 *
 * Scope is src/lib and src/db — the framework-free domain and the data layer,
 * where seed and query time originate. src/app is intentionally out of scope:
 * client components legitimately read the browser clock (which the e2e specs
 * freeze with page.clock instead), so a blanket ban there would fire on
 * genuinely-live UI. Server components under src/app should still thread time
 * from the clock; that is a review expectation, not a machine-checked one.
 */

const ROOT = process.cwd();
const guardedRoots = ["src/lib", "src/db"];
const sourceExtensions = new Set([".ts", ".tsx"]);
// The clock module is the one place the real wall clock is allowed.
const allowed = new Set([path.normalize("src/lib/clock.ts")]);
// Argless `new Date()` and `Date.now()` only — `new Date(startsAt)` and other
// parameterised parses are fine.
const clockPattern = /\bnew Date\(\s*\)|\bDate\.now\(\s*\)/g;

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
    else if (
      sourceExtensions.has(path.extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

const violations = [];
for (const root of guardedRoots) {
  for (const file of await walk(root)) {
    if (allowed.has(path.normalize(file))) continue;
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
  process.exit(1);
}

console.log("clock: domain/data time reads route through src/lib/clock.ts");
