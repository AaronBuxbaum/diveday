import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

/**
 * Performance budget for staff pages on ordinary phones and weak marina Wi-Fi.
 *
 * The metric is the **shared first-load JavaScript**: the chunks that appear in
 * *every* route's first load, so the floor cost a divemaster pays on a phone at
 * the dock before a single pixel of their page exists. Gzipped, since that is
 * what crosses the wire.
 *
 * ## This used to measure something else, and that is why it never fired
 *
 * It read `rootMainFiles` + `polyfillFiles` out of `build-manifest.json`, with
 * the honest note that "the turbopack build does not emit a stable route→chunk
 * map". That was true when it was written. It is not true now: Next 16.3 emits
 * `.next/diagnostics/route-bundle-stats.json`, one entry per route with its
 * `firstLoadChunkPaths`, which is precisely the map whose absence forced the
 * approximation.
 *
 * The approximation was wrong in both directions at once. Measured on the build
 * that fixed it:
 *
 *   counted, but in no route's first load:   38.6 KB  (the `noModule` legacy
 *                                                     polyfill bundle, which no
 *                                                     modern browser fetches)
 *   in every route's first load, but missed: 15.0 KB  across four chunks
 *
 * So it reported 261.5 KB where the true floor was 237.8 KB. Worse than the
 * 24 KB error: the set it measured did not contain the route-level shared
 * chunks at all, so when zod arrived in all 75 routes — 83.5 KB gzip, through
 * `web-vitals-client.tsx` in the root layout — this number **did not move**,
 * and it did not move when zod was removed either. A budget that cannot see the
 * regression it is named after is worse than no budget, because it is read as
 * evidence.
 *
 * Per-route budgets remain out of scope; the shared floor is the largest lever
 * and the easiest to regress. See docs/architecture/performance-budgets.md.
 *
 * With no `.next` at all this prints how to produce one and exits 0, rather
 * than failing a checkout that simply has not built. A `.next` that exists but
 * carries no route stats is a *failure*, not a skip — that is the shape where a
 * guard quietly measures nothing and reports success.
 */

/**
 * Gzipped-KB ceiling for the shared first-load JS.
 *
 * The floor is 237.8 KB as measured. The headroom is deliberately small: a
 * dependency arriving in the root layout's client graph is the failure this
 * exists to catch, and the cheapest one of those on record was 83.5 KB.
 */
const SHARED_FIRST_LOAD_BUDGET_KB = 242;

const NEXT_DIR = ".next";
const ROUTE_STATS = path.join(NEXT_DIR, "diagnostics", "route-bundle-stats.json");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * The chunks every route with a client bundle loads before it can paint.
 *
 * An intersection, not a union: a chunk two routes share is their cost, not the
 * floor. Exported for the test, which is what pins that distinction.
 */
export function sharedFirstLoadChunks(routeStats) {
  const withBundles = routeStats.filter((route) => route.firstLoadChunkPaths?.length);
  if (withBundles.length === 0) return [];
  const [first, ...rest] = withBundles;
  return first.firstLoadChunkPaths.filter((chunk) =>
    rest.every((route) => route.firstLoadChunkPaths.includes(chunk)),
  );
}

async function main() {
  try {
    await readFile(path.join(NEXT_DIR, "build-manifest.json"));
  } catch {
    console.log("perf: no production build found — run `pnpm build` first (skipping budget).");
    return;
  }

  let routeStats;
  try {
    routeStats = await readJson(ROUTE_STATS);
  } catch {
    console.error(
      `perf: ${ROUTE_STATS} is missing from this build, so the shared first-load floor cannot be measured.\n` +
        "  Next 16.3+ writes it on every production build. Do not fall back to an approximation here:\n" +
        "  the previous one reported 261.5 KB against a true 237.8 KB and never moved when 83.5 KB of\n" +
        "  zod entered every route.",
    );
    process.exit(1);
  }

  const shared = sharedFirstLoadChunks(routeStats);
  if (shared.length === 0) {
    console.error(
      "perf: no chunk appears in every route's first load — the build output is not the shape this\n" +
        "  guard reads, and it has measured nothing. Refusing to report a budget it did not check.",
    );
    process.exit(1);
  }

  let totalKb = 0;
  for (const chunk of shared) {
    totalKb += gzipSync(await readFile(chunk)).length / 1024;
  }
  const rounded = Math.round(totalKb * 10) / 10;
  const where = `${shared.length} chunks shared by all ${routeStats.length} routes`;

  if (totalKb > SHARED_FIRST_LOAD_BUDGET_KB) {
    console.error(
      `perf: shared first-load JS is ${rounded} KB gzip (${where}), over the ${SHARED_FIRST_LOAD_BUDGET_KB} KB budget.\n` +
        "  Every route now pays this before it paints. The usual cause is a client component reaching a\n" +
        "  module whose other half is a parser or a driver — check what the root layout's `use client`\n" +
        "  boundaries import, transitively, and split the constant out rather than raising the budget.\n" +
        "  If the growth is genuinely earned, raise it in scripts/perf-budget.mjs with a note in\n" +
        "  docs/architecture/performance-budgets.md.",
    );
    process.exit(1);
  }

  console.log(
    `perf: shared first-load JS ${rounded} KB gzip (${where}), within the ${SHARED_FIRST_LOAD_BUDGET_KB} KB budget.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("perf-budget.mjs")) {
  main().catch((error) => {
    console.error("perf: budget check failed to run.", error);
    process.exit(1);
  });
}
