import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { filesUnder } from "./files-under.mjs";

/**
 * Every query on `roll_call_events` names its subject kind.
 *
 * Seat marks and crew marks are one ledger (issue #2700): a row is about a
 * booking (`subject_kind = 'seat'`) or about an assigned crew member
 * (`subject_kind = 'crew'`). A diver count that forgot to say "seat" would
 * count crew taps as divers, and a crew count that forgot to say "crew" would
 * do the reverse; either puts somebody aboard who is not, and nothing else
 * fails. Joining `bookings` happens to drop crew rows today, which is exactly
 * the kind of accident this guard refuses to rely on.
 *
 * ## What is guarded
 *
 * `.from(T)`, `.innerJoin(T`/`.leftJoin(T`/…, `.update(T)`, `.delete(T)` and
 * a raw `${T}` inside a `sql` template, where `T` is `rollCallEvents` or a
 * name bound by `alias(rollCallEvents, …)`. A query passes when `seatMarks(`,
 * `crewMarks(` or `subjectKind` appears from the anchor to the next anchor or
 * {@link QUERY_WINDOW} lines, whichever is first.
 *
 * ## Saying "both halves on purpose"
 *
 * `diveday:roll-call-both-subjects: <why>` in a comment inside the query or on
 * the three lines above it: the erasure sweep, the export, a delete of a
 * whole trip's ledger.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features", "src/app", "src/lib"];
const SCHEMA_DIR = "src/db/schema";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const QUERY_WINDOW = 40;
const ALLOW = /diveday:roll-call-both-subjects:/;
const IS_TEST = /\.test\.tsx?$/;
const TABLE = "rollCallEvents";
// A filter, not a mention: projecting `subjectKind` does not scope a query.
const NAMES_SUBJECT = /\b(?:seatMarks|crewMarks)\(|\beq\(\s*\w+\.subjectKind\b|subject_kind\s*=/;

/** `rollCallEvents` plus every name an `alias(rollCallEvents, …)` binds in `source`. */
export function rollCallNames(source) {
  const names = [TABLE];
  for (const match of source.matchAll(
    /\b(?:const|let)\s+(\w+)\s*=\s*alias\(\s*rollCallEvents\b/g,
  )) {
    names.push(match[1]);
  }
  return names;
}

function anchorPattern(names) {
  const name = `(?:${names.join("|")})`;
  return new RegExp(
    String.raw`\.(?:from|update|delete)\(\s*${name}\s*\)|\.\w*[jJ]oin\(\s*${name}\b|\$\{${name}\}`,
    "g",
  );
}

function lineOf(source, offset) {
  let line = 0;
  for (let i = 0; i < offset; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Queries on the roll-call ledger in `source` that name no subject kind and give no reason. */
export function findSubjectlessReads(source) {
  const lines = source.split("\n");
  const isComment = (index) => /^\s*(?:\/\/|\*|\/\*)/.test(lines[index] ?? "");
  const anchors = new Set();
  for (const match of source.matchAll(anchorPattern(rollCallNames(source)))) {
    const index = lineOf(source, match.index);
    if (!isComment(index)) anchors.add(index);
  }
  const boundaries = new Set(anchors);
  lines.forEach((line, index) => {
    if (/\.from\(/.test(line) && !isComment(index)) boundaries.add(index);
  });
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const findings = [];
  for (const index of [...anchors].sort((a, b) => a - b)) {
    const next = sortedBoundaries.find((boundary) => boundary > index);
    const end = Math.min(index + QUERY_WINDOW, next ?? lines.length);
    const window = lines.slice(index, end).join("\n");
    const above = lines.slice(Math.max(0, index - 3), index).join("\n");
    if (NAMES_SUBJECT.test(window) || ALLOW.test(window) || ALLOW.test(above)) continue;
    findings.push({ line: index + 1, text: lines[index].trim() });
  }
  return { guarded: anchors.size, findings };
}

async function main() {
  const violations = [];
  let guarded = 0;
  for (const root of GUARDED_ROOTS) {
    for (const file of await filesUnder(
      root,
      (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
      (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)),
    )) {
      if (IS_TEST.test(file)) continue;
      if (path.normalize(file).startsWith(path.normalize(SCHEMA_DIR))) continue;
      const result = findSubjectlessReads(await readFile(path.join(ROOT, file), "utf8"));
      guarded += result.guarded;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }
  if (violations.length > 0) {
    console.error(
      `Queries on roll_call_events that do not name a subject kind:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Add `seatMarks()` or `crewMarks()` (src/db/roll-call-subject.ts) to the query: the table holds both seat and crew marks, and a count that reads both puts somebody aboard who is not.",
    );
    console.error(
      "A query that reads both halves by design says `diveday:roll-call-both-subjects: <why>` in a comment inside it or just above it.",
    );
    process.exit(1);
  }
  console.log(`roll-call-subject: ${guarded} queries on roll_call_events all name a subject kind`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
