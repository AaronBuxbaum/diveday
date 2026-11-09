import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { filesUnder } from "./files-under.mjs";

/**
 * Every person is minted by `createPerson` (`src/db/people.ts`), which writes
 * `people.origin` and the roles together (issue #2726).
 *
 * Nine places used to `.insert(people)` by hand, each choosing its own columns
 * and its own role rows, and nothing recorded how a person came to be beyond
 * one timestamp for one door. A tenth hand-written insert would be a person with
 * no honest origin (the column defaults to `seed`, which means "nobody's door
 * wrote this") and possibly no role.
 *
 * ## What is guarded
 *
 * `.insert(people)` in non-test sources under {@link GUARDED_ROOTS}, anywhere but
 * `src/db/people.ts`. Seeds (`seed*.ts`), fixtures, `src/test/` and `src/app/api/test/` are exempt: a fixture
 * has no door. A write that is not a new person says
 * `diveday:allow-person-insert: <why>` in a comment on the line or just above it.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IS_TEST = /\.test\.tsx?$/;
const DOOR = path.normalize("src/db/people.ts");
const INSERT = /\.insert\(\s*people\s*,?\s*\)/g;
const ALLOW = /diveday:allow-person-insert:/;

/** Every `.insert(people)` in one file's source that does not say why it is there. */
export function findPersonInserts(source) {
  const lines = source.split("\n");
  const findings = [];
  for (const match of source.matchAll(INSERT)) {
    const index = source.slice(0, match.index).split("\n").length - 1;
    const near = `${lines[index - 1] ?? ""}\n${lines[index] ?? ""}`;
    if (ALLOW.test(near)) continue;
    findings.push({ line: index + 1, text: lines[index].trim() });
  }
  return findings;
}

/** A fixture has no door: seeds, test-support files and the `/api/test` routes. */
function isFixture(normalized) {
  const base = path.basename(normalized);
  return (
    base.startsWith("seed") ||
    base.includes("fixtures") ||
    normalized.startsWith(path.normalize("src/test/")) ||
    normalized.startsWith(path.normalize("src/app/api/test/"))
  );
}

async function main() {
  const violations = [];
  for (const root of GUARDED_ROOTS) {
    for (const file of await filesUnder(
      root,
      (relativeDirectory) => readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true }),
      (relativePath) => SOURCE_EXTENSIONS.has(path.extname(relativePath)),
    )) {
      const normalized = path.normalize(file);
      if (normalized === DOOR || IS_TEST.test(file)) continue;
      if (isFixture(normalized)) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      for (const finding of findPersonInserts(source)) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `A person minted outside createPerson:\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
    );
    console.error(
      "Call `createPerson(tx, { shopId, fullName, email, phone, origin, roles })` (src/db/people.ts): it writes the origin and the roles with the row. A write that is not a new person says `diveday:allow-person-insert: <why>`.",
    );
    process.exit(1);
  }

  console.log("person-door: every person is minted by createPerson");
}

if (import.meta.main) await main();
