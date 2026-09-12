import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Every write that moves a departure bumps `trips.revision`.
 *
 * `trips.revision` is published as the RFC 5545 `SEQUENCE` on both calendar
 * surfaces (`src/lib/trip-calendar.ts`, read by the staff feed and by the
 * per-trip `.ics`). A client treats a re-fetched event with the same `SEQUENCE`
 * as the event it already has, so a departure whose `starts_at` moved without a
 * bump leaves every subscribed calendar sitting on the old `DTSTART` — and a
 * diver at the dock at the old time. That is issue #1165, which was fixed at the
 * two writers that existed then. Each of the three that move a boat today
 * carries a comment saying so, added by hand one at a time; nothing made the
 * third one carry it and nothing would make a fourth.
 *
 * ## What is guarded
 *
 * Every `.update(trips)` whose `.set()` literal writes `startsAt`. The anchor is
 * the table, not the column, and that is the whole reason the rule is
 * affordable: `moveTrip` writes `.update(tripScheduleDays).set({ startsAt:
 * shift(day.startsAt), endsAt: shift(day.endsAt) })` three statements below its
 * own bump (`src/db/trips-schedule.ts`), and a rule anchored on `startsAt` would
 * have failed that correct line on day one. A child day has no `SEQUENCE` of its
 * own; only the trip does.
 *
 * A guarded write passes when `revision` appears in the same literal. One test
 * covers both shapes in the tree: the unconditional `revision: sql`${…} + 1``
 * (`moveTrip`, `refreshDemoShop`) and the conditional spread
 * `...(revisionMoved ? { revision: … } : {})` (`updateTrip`, which moves a boat
 * and renames it in one statement and must only re-alert for the first).
 *
 * A `.set()` that does not touch `startsAt` is not a calendar move and is not
 * inspected further — that is what keeps the status writers, the minimum sweep,
 * the recap writers, the series cancellations and the soft delete out of it.
 *
 * ## What is deliberately *not* guarded
 *
 * The opposite mistake — bumping for something immaterial, which re-alerts every
 * diver's phone for a typo fixed in a conditions note — has no mechanical
 * signature and is left to review. Guarding the cheap half of a rule beats
 * guarding neither.
 *
 * ## Saying "this one really does move a boat nobody subscribes to"
 *
 * Put `diveday:allow-flat-revision: <why>` in a comment above the write or
 * inside the literal. The legitimate cases are the `/api/test/*` fixtures, which
 * re-time departures inside a per-worker test database no calendar has ever seen.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features", "src/app", "src/lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * How far past `.update(trips)` to look for the `.set()` that belongs to it.
 * Twelve lines covers every builder chain in the tree with room to spare — the
 * longest gap today is the four comment lines `refreshDemoShop` puts between the
 * two calls.
 *
 * **The window also stops at the next anchor, and that half is not a tuning
 * knob.** It is the lesson issue #635 taught `scripts/check-live-trips.mjs`, and
 * it is ported here verbatim rather than re-learned: a fixed line count alone let
 * one query pass because a *neighbouring* one carried the thing being looked for.
 * A write may never be proven by its neighbour, so the search for a `.set()` —
 * and the brace match that reads its literal — both end where the next
 * `.update(trips)` begins.
 */
const SET_WINDOW = 12;

const ANCHOR = /\.update\(\s*trips\s*\)/;
const ALLOW = /diveday:allow-flat-revision:/;
const CALENDAR_MOVE = /\bstartsAt\b/;
const BUMPS = /\brevision\b/;
const IS_TEST = /\.test\.tsx?$/;
const COMMENT_LINE = /^(?:\/\/|\/\*|\*)/;

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
 * The object literal starting at the first `{` at or after `from`, by depth
 * count.
 *
 * Text, not a parser, and the two shapes it has to survive are both in the tree:
 * the balanced `${trips.revision}` inside a `sql` template literal, and the
 * `...(cond ? { … } : {})` spread. Both are pinned in
 * `check-trip-revision.test.mjs`. A `}` inside a *string* would end the scan
 * early; no `.set()` on a trip writes one today, and the failure mode is a
 * missed write rather than a false accusation.
 */
function objectLiteralAt(text, from) {
  const open = text.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return text.slice(open);
}

/** The run of comment lines directly above `index`, which is where an exemption reads best. */
function commentBlockStart(lines, index) {
  let start = index;
  while (start > 0 && COMMENT_LINE.test(lines[start - 1].trim())) start -= 1;
  return start;
}

/**
 * Every write of `trips.startsAt` in one file, and which of them leave the
 * calendar behind.
 *
 * Split out so the rule is testable in isolation — the shapes it has to get
 * right are a conditional spread and a template literal inside an object
 * literal, both trivial to state as a string and awkward to stage as a fixture
 * tree.
 */
export function findFlatRevisionWrites(source) {
  const lines = source.split("\n");
  const anchors = lines.reduce((found, line, index) => {
    if (ANCHOR.test(line)) found.push(index);
    return found;
  }, []);
  const findings = [];
  let moves = 0;
  anchors.forEach((index, position) => {
    // Everything this write is allowed to be proven by ends at the next one —
    // see {@link SET_WINDOW}.
    const limit = anchors[position + 1] ?? lines.length;
    const setLine = lines
      .slice(index, Math.min(index + SET_WINDOW, limit))
      .findIndex((line) => line.includes(".set("));
    if (setLine === -1) return;
    const body = lines.slice(index + setLine, limit).join("\n");
    const literal = objectLiteralAt(body, body.indexOf(".set(") + 1);
    if (!CALENDAR_MOVE.test(literal)) return;
    moves += 1;
    if (BUMPS.test(literal)) return;
    const preamble = lines.slice(commentBlockStart(lines, index), index + setLine).join("\n");
    if (ALLOW.test(preamble) || ALLOW.test(literal)) return;
    findings.push({ line: index + 1, text: lines[index].trim() });
  });
  return { guarded: anchors.length, moves, findings };
}

async function main() {
  const violations = [];
  let guarded = 0;
  let moves = 0;

  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      if (IS_TEST.test(file) || path.basename(file).startsWith("seed-")) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      const result = findFlatRevisionWrites(source);
      guarded += result.guarded;
      moves += result.moves;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Writes of \`trips.startsAt\` that leave the calendar on the old time:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Bump `revision` in the same `.set()` — `moveTrip` (src/db/trips-schedule.ts) shows the unconditional shape, `updateTrip` (src/db/trips-record.ts) the conditional one for a statement that may only be renaming. `trips.revision` is published as the RFC 5545 `SEQUENCE` by both calendar surfaces (src/lib/trip-calendar.ts), so a departure that moves without a bump is an event every subscribed client already believes it has — and a diver standing at the dock at the old time (issue #1165).",
    );
    console.error(
      "A write that genuinely moves a departure nobody can subscribe to (an `/api/test/*` fixture re-timing a per-worker test database) says `diveday:allow-flat-revision: <why>` in a comment above it or inside the literal.",
    );
    process.exit(1);
  }

  // Both numbers, because they answer different questions: the first is the
  // coverage this guard actually asserts, the second the breadth it read to
  // find it. Reporting the anchors alone would claim eighteen calendar moves
  // where there are five, and most `.update(trips)` writes are a status or a
  // soft delete that this rule never inspects.
  console.log(
    `trip-revision: ${moves} writes of trips.startsAt all bump the calendar revision (or say why they don't), found across ${guarded} writes of trips`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
