import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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
 *
 * ## The order of marks
 *
 * The same scan refuses sorting a roll-call mark by hand (`asc(`/`desc(`/a bare
 * `.orderBy(` on `occurredAt`, `createdAt` or `seq`, a raw `${T.x} desc`, a raw
 * `${T.seq}`) and comparing two marks' order columns (`gt(`, `lt(`, …) anywhere but
 * `src/db/roll-call-order.ts`. Newest wins on `occurred_at`, `created_at`,
 * `seq`; the rule was written by hand 39 times, and forgetting `seq` once
 * left every test green and a diver reading as back aboard (ADR
 * 20260815-roll-call-order-is-a-property-of-the-data). Projecting `seq` to
 * sort in memory is fine; `compareMarkOrder` (src/lib/roll-call.ts) sorts it.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/features", "src/app", "src/lib"];
const SCHEMA_DIR = "src/db/schema";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const QUERY_WINDOW = 40;
const ALLOW = /diveday:roll-call-both-subjects:/;
const IS_TEST = /\.test\.tsx?$/;
const TABLE = "rollCallEvents";
const ORDER_HOME = "src/db/roll-call-order.ts";
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

/** Hand-written orderings or comparisons on a roll-call `.seq` in `source`. */
export function findHandOrderedMarks(source) {
  const lines = source.split("\n");
  const name = `(?:${rollCallNames(source).join("|")})`;
  const pattern = new RegExp(
    [
      String.raw`\b(?:asc|desc)\(\s*${name}\.(?:occurredAt|createdAt|seq)\b`,
      String.raw`\b(?:gt|lt|gte|lte)\(\s*${name}\.(?:occurredAt|createdAt|seq)\s*,\s*\w+\.(?:occurredAt|createdAt|seq)\b`,
      String.raw`\b(?:gt|lt|gte|lte)\(\s*${name}\.seq\b`,
      String.raw`,\s*${name}\.seq\s*\)`,
      String.raw`\.orderBy\(\s*${name}\.(?:occurredAt|createdAt|seq)\b`,
      String.raw`\$\{${name}\.(?:occurredAt|createdAt|seq)\}\s+(?:asc|desc)\b`,
      String.raw`\$\{${name}\.seq\}`,
    ].join("|"),
    "i",
  );
  const findings = [];
  lines.forEach((line, index) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    if (pattern.test(line)) findings.push({ line: index + 1, text: line.trim() });
  });
  return findings;
}

async function main() {
  const violations = [];
  const orderings = [];
  let guarded = 0;
  for (const root of GUARDED_ROOTS) {
    for (const file of await filesUnder(
      root,
      (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
      (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)),
    )) {
      if (IS_TEST.test(file)) continue;
      if (path.normalize(file).startsWith(path.normalize(SCHEMA_DIR))) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      if (path.normalize(file) !== path.normalize(ORDER_HOME)) {
        for (const finding of findHandOrderedMarks(source)) {
          orderings.push(`${file}:${finding.line}: ${finding.text}`);
        }
      }
      const result = findSubjectlessReads(source);
      guarded += result.guarded;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }
  if (orderings.length > 0) {
    console.error(
      `Roll-call marks ordered by hand:\n${orderings.map((line) => `- ${line}`).join("\n")}`,
    );
    console.error(
      "Use `newestMarkFirst()`, `oldestMarkFirst()` or `isNewerMark()` from src/db/roll-call-order.ts, or `compareMarkOrder` from src/lib/roll-call.ts in memory: the order is occurred_at, created_at, seq, and a hand-written copy is how one of them goes missing.",
    );
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
  }
  if (violations.length > 0 || orderings.length > 0) process.exit(1);
  console.log(
    `roll-call-subject: ${guarded} queries on roll_call_events all name a subject kind; marks are ordered in one place`,
  );
}

if (import.meta.main) await main();
