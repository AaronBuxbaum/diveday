import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { filesUnder } from "./files-under.mjs";

/**
 * A read of `activity_events` outside `src/db` filters to the diver audience or says why staff lines are right there.
 *
 * Desk lines (the staff's own notes to each other) live in `activity_events`
 * with `audience = 'staff'` since the #2701 fold, beside the diver's own trail.
 * The disclosure test (`src/db/desk-lines-disclosure.test.ts`) checks the
 * readers in `src/db` and the imports of the diver-facing route folders; it
 * cannot see a feature module, a lib helper or a new route that queries the
 * table itself (security review of #2701, finding 1; issue #3874). This guard
 * is the rule #2701 proposed for that gap.
 *
 * ## What is guarded
 *
 * Every `.ts`/`.tsx` file under `src/` except `src/db/**` and tests. A read is
 * a `.from(activityEvents)`, a join onto it, or raw SQL naming
 * `from|join activity_events`. Writes (`insert`, `update`) are not reads.
 *
 * A read passes when its own query, within {@link QUERY_WINDOW} lines of the
 * anchor and before the next one, filters `activityEvents.audience` to
 * `"diver"`, or carries `diveday:allow-staff-events: <why>` in a comment.
 * Ending at the next anchor is issue #635's lesson from
 * `check-live-trips.mjs`: a neighbour's filter never proves a read.
 */

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const QUERY_WINDOW = 60;
const ANCHOR =
  /\.from\(\s*activityEvents\s*\)|\.(?:inner|left|right|full)Join\(\s*activityEvents\b|\b(?:from|join)\s+"?activity_events"?\b/i;
const DIVER_FILTER = /activityEvents\.audience\s*,\s*["']diver["']|audience"?\s*=\s*'diver'/;
const ALLOW = /diveday:allow-staff-events:[ \t]*\S[^\n]{9,}/;
const IS_TEST = /\.test\.tsx?$/;

/** Whether `file` (relative to the repository root) is one this guard reads. */
export function guardsFile(file) {
  const normalized = file.split(path.sep).join("/");
  if (!normalized.startsWith("src/") || normalized.startsWith("src/db/")) return false;
  if (IS_TEST.test(normalized)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(normalized));
}

/** Every read of `activity_events` in one source, and which of them prove nothing. */
export function findUnmarkedStaffEventReads(source) {
  const lines = source.split("\n");
  const anchors = lines.reduce((found, line, index) => {
    if (ANCHOR.test(line)) found.push(index);
    return found;
  }, []);
  const findings = [];
  anchors.forEach((index, position) => {
    const end = Math.min(index + QUERY_WINDOW, anchors[position + 1] ?? lines.length);
    const window = lines.slice(index, end).join("\n");
    if (DIVER_FILTER.test(window) || ALLOW.test(window)) return;
    findings.push({ line: index + 1, text: lines[index].trim() });
  });
  return { guarded: anchors.length, findings };
}

async function main() {
  const violations = [];
  let guarded = 0;
  const files = await filesUnder(
    "src",
    (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
    (relativePath) => guardsFile(relativePath),
  );
  for (const file of files) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    const result = findUnmarkedStaffEventReads(source);
    guarded += result.guarded;
    for (const finding of result.findings) {
      violations.push(`${file}:${finding.line}: ${finding.text}`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `Reads of \`activity_events\` outside src/db that could reach staff desk lines:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      'Filter the query to the diver audience (`eq(activityEvents.audience, "diver")`), or move the read into a src/db reader. A read that is meant for staff says `diveday:allow-staff-events: <why>` in a comment inside the query.',
    );
    process.exit(1);
  }

  console.log(
    `staff-events: ${guarded} reads of activity_events outside src/db all filter to the diver audience (or say why they don't)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
