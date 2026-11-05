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
 * anchor and before the next one, filters with `eq(activityEvents.audience,
 * "diver")` (or SQL `audience = 'diver'`) and nowhere lets the staff audience
 * through (`ne(...)`, a `"staff"` comparison), or carries
 * `diveday:allow-staff-events: <why>` in a comment. Comments are blanked
 * before the filter is read, so a comment naming the filter proves nothing.
 * The table is recognised bare, through a namespace import
 * (`schema.activityEvents`), under an `alias(activityEvents, …)`, and when
 * raw SQL interpolates it (`from ${activityEvents}`); security review of
 * layer 2, S2.
 * Ending at the next anchor is issue #635's lesson from
 * `check-live-trips.mjs`: a neighbour's filter never proves a read.
 */

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const QUERY_WINDOW = 60;
const IS_TEST = /\.test\.tsx?$/;
const ALLOW = /diveday:allow-staff-events:[ \t]*\S[^\n]{9,}/;
/** `activityEvents`, bare or through a namespace import (`schema.activityEvents`). */
const TABLE = String.raw`(?:\w+\.)?activityEvents`;
/** `const ae = alias(activityEvents, "ae")`: the alias reads the same table. */
const ALIAS = new RegExp(String.raw`\b(\w+)\s*=\s*alias\(\s*${TABLE}\b`, "g");

/** The anchors and filters for one source: the table under every name it has there. */
function patterns(source) {
  // An alias is `\w+`, so it needs no escaping inside a pattern.
  const aliases = [...source.matchAll(ALIAS)].map((match) => match[1]);
  const names = [TABLE, ...aliases].join("|");
  return {
    anchor: new RegExp(
      [
        String.raw`\.from\(\s*(?:${names})\s*\)`,
        String.raw`\.(?:inner|left|right|full)Join\(\s*(?:${names})\b`,
        String.raw`\b(?:from|join)\s+"?activity_events"?\b`,
        // Raw SQL that interpolates the table object reads it too.
        String.raw`\b(?:from|join)\s+\$\{\s*${TABLE}\s*\}`,
      ].join("|"),
      "i",
    ),
    // Only an equality to the diver audience proves a read; a `ne(...)` or an
    // `or(...)` that also lets "staff" through is caught by STAFF_AUDIENCE.
    diver: new RegExp(
      String.raw`\beq\(\s*(?:${names})\.audience\s*,\s*["']diver["']\s*\)|\baudience"?\s*=\s*'diver'`,
    ),
    staff: new RegExp(
      String.raw`\bne\(\s*(?:${names})\.audience\b|(?:${names})\.audience\s*,\s*["']staff["']|\baudience"?\s*(?:=|<>|!=)\s*'staff'|\baudience"?\s*(?:<>|!=)\s*'diver'`,
    ),
  };
}

/** The source with its comments blanked, line structure kept: a comment proves nothing. */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_match, before) => before);
}

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
  const code = withoutComments(source).split("\n");
  const { anchor, diver, staff } = patterns(source);
  const anchors = code.reduce((found, line, index) => {
    if (anchor.test(line)) found.push(index);
    return found;
  }, []);
  const findings = [];
  anchors.forEach((index, position) => {
    const end = Math.min(index + QUERY_WINDOW, anchors[position + 1] ?? lines.length);
    if (ALLOW.test(lines.slice(index, end).join("\n"))) return;
    const window = code.slice(index, end).join("\n");
    if (diver.test(window) && !staff.test(window)) return;
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
