import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Every read of `trips` that means "the board" filters out deleted departures.
 *
 * Deleting a departure sets `trips.deleted_at` rather than removing the row
 * (ADR 20260820-every-delete-is-soft), so the row and all five of its child
 * tables — its dive plan, its schedule days, its crew, its requirements, its
 * last-minute promo — survive the delete. That is what makes putting the
 * departure back a single column write. It is also what makes a forgotten
 * reader render a departure the shop took off the board.
 *
 * **The failure this exists to catch is a public one.** `/s/<slug>` and the
 * sitemap read trips directly; a missing filter there does not throw, does not
 * fail a test that was written before the column existed, and does not look
 * wrong in review — it shows an anonymous visitor a departure they can try to
 * book. The follow-up that proposed this change (FU-20260820-soft-delete-a-
 * departure) named exactly that risk, and "audit every reader" is a promise
 * this script keeps rather than a sentence in a commit message.
 *
 * ## What is guarded
 *
 * Two shapes, both of which can surface a deleted row:
 *
 * 1. `.from(trips)` — a select rooted at the table.
 * 2. `.innerJoin(trips, …)` / `.leftJoin(trips, …)` from one of the child
 *    tables that now *survives* a delete. A join from `bookings`,
 *    `tripWaitlistEntries` or either roll-call table is **not** guarded:
 *    `deleteTrip` refuses a departure carrying any of those, so there is no
 *    such row to arrive through.
 *
 * A guarded query passes when `liveTrip()` (`src/db/trips-live.ts`) appears
 * inside it — within {@link QUERY_WINDOW} lines of the anchor, which comfortably
 * covers every query shape in the tree.
 *
 * ## Saying "this one really does mean deleted rows too"
 *
 * Put `diveday:allow-deleted-trips: <why>` in a comment inside the query. The
 * legitimate cases are few and each is a different kind of read: the export
 * bundle (a shop taking *everything* it has, tombstones included), the series
 * horizon roll's own bookkeeping (it reads the cadence, not the board), the
 * seeds, and any future staff view of deleted departures.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features", "src/app", "src/lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * How far past the anchor line to look for the filter, when nothing closer ends
 * the search first. Generous on purpose: a paged board query with four joins
 * and a keyset cursor is comfortably 40 lines between `.from(trips)` and the
 * end of its `where`, and a false failure on a correct query teaches people to
 * reach for the exemption comment, which is worse than looking too far.
 *
 * **The window also stops at the next anchor, and that half is not a tuning
 * knob.** A fixed line count alone let one query pass because a *neighbouring*
 * one filtered; the docstring used to answer that with "which a reviewer
 * catches", and the reviewer did not. `listTripsReadiness` shipped a
 * site-requirement join with no `liveTrip()` twelve lines above a course read
 * that had one, inside the same `queryAll` array, and this script counted it
 * among the reads it called filtered (issue #635).
 *
 * Ending at the next anchor is the cheapest rule that closes that hole without
 * shrinking the count: a query is now only ever proven by a filter that is
 * inside *it*. Shrinking the number instead would have traded this hole for the
 * false failures the paragraph above exists to avoid.
 */
const QUERY_WINDOW = 60;

const ANCHOR =
  /\.from\(trips\)|\.(?:inner|left)Join\(\s*trips,\s*eq\(trips\.id,\s*(tripAssignments|tripDives|tripScheduleDays|tripRequirements|tripLastMinutePromos|activityEvents|tripBlowouts)\./;
const ALLOW = /diveday:allow-deleted-trips:/;
const IS_TEST = /\.test\.tsx?$/;

/**
 * Files where *every* read of `trips` is legitimately unfiltered, so a comment
 * per query would be eight copies of one sentence.
 *
 * - The seeds and the demo refresh write the board rather than reading it.
 * - `src/db/export.ts` is the shop taking everything it owns. A departure they
 *   deleted is still their row, and a backup that quietly drops rows is not a
 *   backup — the bundle's own child joins read through its trip set rather than
 *   through the board, so they inherit the same answer. The reasoning is
 *   written at the two query sites as well, where a reader will meet it.
 */
const SKIPPED_FILES = new Set(
  [
    "src/db/seed.ts",
    "src/db/demo-refresh.ts",
    "src/db/export.ts",
    "src/app/api/test/seed-trouble-states/route.ts",
  ].map((file) => path.normalize(file)),
);

async function walk(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

/**
 * Every guarded read of `trips` in one file, and which of them prove nothing.
 *
 * Split out so the rule is testable in isolation
 * (`check-live-trips.test.mjs`) — the shape it has to get right is two queries
 * sharing one array, which is awkward to stage as a fixture tree and trivial to
 * state as a string.
 */
export function findUnfilteredTripReads(source) {
  const lines = source.split("\n");
  const anchors = lines.reduce((found, line, index) => {
    if (ANCHOR.test(line)) found.push(index);
    return found;
  }, []);
  const findings = [];
  anchors.forEach((index, position) => {
    // The window stops at the *next* anchor, so one query can never be covered
    // by its neighbour's filter — see {@link QUERY_WINDOW}.
    const end = Math.min(index + QUERY_WINDOW, anchors[position + 1] ?? lines.length);
    const window = lines.slice(index, end).join("\n");
    if (window.includes("liveTrip()") || ALLOW.test(window)) return;
    findings.push({ line: index + 1, text: lines[index].trim() });
  });
  return { guarded: anchors.length, findings };
}

async function main() {
  const violations = [];
  let guarded = 0;

  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      const normalized = path.normalize(file);
      if (SKIPPED_FILES.has(normalized) || IS_TEST.test(file)) continue;
      if (path.basename(file).startsWith("seed-")) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      const result = findUnfilteredTripReads(source);
      guarded += result.guarded;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Reads of \`trips\` that would surface a deleted departure:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Add `liveTrip()` (src/db/trips-live.ts) to the query's where clause. Deleting a departure sets `trips.deleted_at` and leaves the row and its children in place, so an unfiltered read shows a departure the shop took off the board — on the public schedule, that is a seat an anonymous visitor can try to book.",
    );
    console.error(
      "A read that genuinely means deleted rows too (the export bundle, the series horizon roll, a staff view of deleted departures) says `diveday:allow-deleted-trips: <why>` in a comment inside the query.",
    );
    process.exit(1);
  }

  console.log(
    `live-trips: ${guarded} reads of trips all filter deleted departures (or say why they don't)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
