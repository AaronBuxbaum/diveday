import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { filesUnder } from "./files-under.mjs";

/**
 * A reader of `bookings.status` says which of the two meanings it wants
 * (issue #2758).
 *
 * `ne(bookings.status, "cancelled")` was typed by hand more than 200 times and
 * reads as "not cancelled" while meaning two different things: the seats
 * somebody still holds, or everybody who is on the boat's list. A `no_show` has
 * released its seat but is still on the roster and the manifest, so the clause
 * is right for the second question and wrong for the first, and nothing in the
 * clause says which one the author meant. `seatHeld` and `seatNotCancelled`
 * (`src/db/trips-queries.ts`) are the two answers, each one identifier a
 * reviewer can grep.
 *
 * ## What is guarded
 *
 * The spelled-out `ne(bookings.status, "cancelled")`, on one line or split
 * across several, in non-test sources under {@link GUARDED_ROOTS}.
 * `src/db/trips-queries.ts` is where it is defined and is the one exemption.
 * A reader that genuinely means something else says `diveday:allow-status-clause: <why>`
 * in a comment on the line or the line above.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IS_TEST = /\.test\.tsx?$/;
const DEFINITION = path.normalize("src/db/trips-queries.ts");
const CLAUSE = /\bne\(\s*bookings\.status,\s*"cancelled"\s*,?\s*\)/g;
const ALLOW = /diveday:allow-status-clause:/;

/** Every spelled-out clause in one file's source that does not say why it is there. */
export function findRawCancelledClauses(source) {
  const lines = source.split("\n");
  const findings = [];
  for (const match of source.matchAll(CLAUSE)) {
    const index = source.slice(0, match.index).split("\n").length - 1;
    const near = `${lines[index - 1] ?? ""}\n${lines[index] ?? ""}`;
    if (ALLOW.test(near)) continue;
    findings.push({ line: index + 1, text: lines[index].trim() });
  }
  return findings;
}

async function main() {
  const violations = [];
  for (const root of GUARDED_ROOTS) {
    for (const file of await filesUnder(
      root,
      (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
      (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)),
    )) {
      if (path.normalize(file) === DEFINITION || IS_TEST.test(file)) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      for (const finding of findRawCancelledClauses(source)) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `A hand-typed \`ne(bookings.status, "cancelled")\`:\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
    );
    console.error(
      "Say which meaning you want: `seatHeld` for the seats somebody still holds, `seatNotCancelled` for everyone not cancelled, a `no_show` included (both in src/db/trips-queries.ts). A clause that means something else says `diveday:allow-status-clause: <why>`.",
    );
    process.exit(1);
  }

  console.log('seat-status: no hand-typed ne(bookings.status, "cancelled")');
}

if (import.meta.main) await main();
