import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * No list is ordered by a timestamp and then a random id alone.
 *
 * `orderBy(asc(x.createdAt), asc(x.id))` reads as a total order and is one in
 * production, where `created_at` comes from the clock and two rows are
 * microseconds apart, so the id never decides anything. Under test it decides
 * everything: the clock is frozen at the harness boundary
 * (`TEST_FROZEN_CLOCK`), every row a run writes shares one instant, and the
 * whole order is a `defaultRandom()` uuid that differs in every seeded
 * database. Three visual baselines re-ordered themselves that way on commits
 * that touched neither the surface nor its query (the manifest rail #1720, the
 * lobby Screens list, the crew-clash week), and each was found by eye in a diff
 * image (issue #1762, ruled H-81).
 *
 * ## What is guarded
 *
 * Every `.orderBy(…)` whose **last two** keys are a column ending in `At` and
 * then an `id`. Every `id` in this schema is a `defaultRandom()` uuid, so the
 * rule does not read `schema.ts` to ask. The fix is a key a person could
 * predict, between the two: a name, a title, a code. The id stays last, for a
 * total order.
 *
 * ## What is deliberately *not* guarded
 *
 * `src/db/export.ts`, whole. A CSV's row order is not something a person reads
 * as meaningful, stability within one database is all an export needs, and it
 * holds most of the matches in the tree, so a reason on each line would be
 * forty-odd copies of the same sentence. Tests are skipped too: a test's own
 * query is not a list anyone is shown.
 *
 * A JavaScript comparator that ties on a timestamp (`src/lib/staffing-week.ts`'s
 * `byStart`) has the same failure and no mechanical signature this rule can
 * read; it is left to review.
 *
 * ## Saying "nobody reads this order"
 *
 * Put `diveday:allow-time-id-order: <why>` in a comment directly above the
 * `.orderBy(` or inside its arguments. The legitimate cases are a cursor or an
 * outbox drain, where the order is a delivery order nobody is shown, and a seed
 * picking the first of a list that holds one row.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features", "src/app", "src/lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const EXEMPT_FILES = new Set([path.join("src", "db", "export.ts")]);
const IS_TEST = /\.test\.tsx?$/;
const COMMENT_LINE = /^(?:\/\/|\/\*|\*)/;
// `:\s*\S`, as every other exemption in `scripts/` spells it: a marker with
// nothing after the colon silences the guard and tells the next reader nothing.
const ALLOW = /diveday:allow-time-id-order:[ \t]*\S/;
const TIMESTAMP_KEY = /\.\w+At\b/;
const ID_KEY = /^(?:(?:asc|desc)\(\s*)?[\w.]+\.id\s*\)?$/;

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
 * The argument text of the call whose `(` is at `open`, by depth count, and the
 * index just past its `)`. Text, not a parser: a paren inside a string would
 * end the scan early, and no `orderBy` in the tree carries one.
 */
function argumentsAt(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return text.slice(open + 1);
}

/** Split an argument list at its top-level commas. */
function topLevelArguments(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !COMMENT_LINE.test(line.trim()))
        .join(" ")
        .trim(),
    )
    .filter((part) => part.length > 0);
}

/** The run of comment lines directly above `index`. */
function commentAbove(lines, index) {
  let start = index;
  while (start > 0 && COMMENT_LINE.test(lines[start - 1].trim())) start -= 1;
  return lines.slice(start, index).join("\n");
}

/**
 * Every `orderBy` in one file whose order a frozen clock hands to a random id.
 * Split out so the shapes are testable as strings (`check-time-id-order.test.mjs`).
 */
export function findTimeIdOrders(source) {
  const lines = source.split("\n");
  const lineStarts = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const lineOf = (index) => {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= index) line += 1;
    return line;
  };

  const findings = [];
  let orders = 0;
  const call = /\.orderBy\(/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    orders += 1;
    const open = match.index + match[0].length - 1;
    const raw = argumentsAt(source, open);
    const keys = topLevelArguments(raw);
    if (keys.length < 2) continue;
    const [timestamp, id] = keys.slice(-2);
    if (!TIMESTAMP_KEY.test(timestamp) || !ID_KEY.test(id)) continue;
    const line = lineOf(match.index);
    if (ALLOW.test(raw) || ALLOW.test(commentAbove(lines, line)) || ALLOW.test(lines[line])) {
      continue;
    }
    findings.push({ line: line + 1, text: lines[line].trim() });
  }
  return { orders, findings };
}

async function main() {
  const violations = [];
  let orders = 0;

  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      if (IS_TEST.test(file) || EXEMPT_FILES.has(file)) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      const result = findTimeIdOrders(source);
      orders += result.orders;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Lists ordered by a timestamp and then a random id:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Under the frozen test clock every row shares one instant, so the uuid decides the whole order and the visual baseline re-orders itself on an unrelated commit (issue #1762). Put a key a person could predict between the two (a name, a title, a code) and keep the id last.",
    );
    console.error(
      "An order nobody is shown (a cursor, an outbox drain, a seed picking its only row) says `diveday:allow-time-id-order: <why>` in a comment directly above the `.orderBy(` or inside it. An exemption with nothing after the colon is refused.",
    );
    process.exit(1);
  }

  console.log(
    `time-id-order: no list among ${orders} orderBy calls is decided by a random id under a frozen clock (src/db/export.ts exempt)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
