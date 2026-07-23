import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

/**
 * Performance budget for staff pages on ordinary phones and weak marina Wi-Fi.
 *
 * The metric is the shared first-load JavaScript: the chunks every route pulls
 * before it can paint (Next's `rootMainFiles` + polyfills). It is the floor cost
 * a divemaster pays on a phone at the dock — the one number that, left ungoverned,
 * creeps up a dependency at a time until the board is slow where it matters most.
 * We budget the gzipped size, since that is what actually crosses the wire.
 *
 * Per-route budgets are deliberately out of scope for now: the turbopack build
 * does not emit a stable route→chunk map, and the shared baseline is both the
 * largest lever and the easiest to regress. See
 * docs/architecture/performance-budgets.md.
 *
 * Runs after `pnpm build` (the checks CI job); with no `.next` it prints how to
 * produce one and exits 0 rather than failing a checkout that simply hasn't built.
 */

/** Gzipped-KB ceiling for the shared first-load JS. Current is ~164 KB. */
const SHARED_FIRST_LOAD_BUDGET_KB = 190;

const NEXT_DIR = ".next";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function gzipKb(file) {
  const bytes = await readFile(path.join(NEXT_DIR, file));
  return gzipSync(bytes).length / 1024;
}

async function main() {
  let manifest;
  try {
    manifest = await readJson(path.join(NEXT_DIR, "build-manifest.json"));
  } catch {
    console.log("perf: no production build found — run `pnpm build` first (skipping budget).");
    return;
  }

  const files = [
    ...new Set([...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])]),
  ];
  if (files.length === 0) {
    console.error("perf: build-manifest.json has no rootMainFiles — cannot measure the budget.");
    process.exit(1);
  }

  let totalKb = 0;
  for (const file of files) {
    totalKb += await gzipKb(file);
  }
  const rounded = Math.round(totalKb * 10) / 10;

  if (totalKb > SHARED_FIRST_LOAD_BUDGET_KB) {
    console.error(
      `perf: shared first-load JS is ${rounded} KB gzip, over the ${SHARED_FIRST_LOAD_BUDGET_KB} KB budget.\n` +
        "  A staff page's floor cost regressed. Trim a client dependency or push work server-side,\n" +
        "  or raise the budget in scripts/perf-budget.mjs with a note in docs/architecture/performance-budgets.md.",
    );
    process.exit(1);
  }

  console.log(
    `perf: shared first-load JS ${rounded} KB gzip, within the ${SHARED_FIRST_LOAD_BUDGET_KB} KB budget.`,
  );
}

main().catch((error) => {
  console.error("perf: budget check failed to run.", error);
  process.exit(1);
});
