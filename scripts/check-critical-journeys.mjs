import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **The critical journeys keep their browser test.**
 *
 * docs/engineering/testing.md's "Critical journeys" table names the ~15 walks a
 * shop cannot lose (book, pay, sign, check in, roll call, …), each with the spec
 * and the test title that proves it. It replaced the AGENTS.md rule "every
 * important flow gets an e2e/ spec, every important surface a capture" (testing
 * review decision 2, 2026-10-14), which grew a backlog of "add captures" issues by
 * rule while saying nothing about which walks mattered. This guard is what makes
 * the list a floor rather than a wish: a row whose spec is gone, whose test was
 * renamed or deleted, or whose test is skipped fails check:repo. Renaming a
 * journey's test is fine; the same change renames the row.
 *
 * A row reads `| Journey | \`e2e/<file>.spec.ts\` | <exact test title> |`.
 */

export const LEDGER = "docs/engineering/testing.md";
const SECTION = "## Critical journeys";
const ROW = /^\|\s*([^|]+?)\s*\|\s*`(e2e\/[^`]+\.spec\.ts)`\s*\|\s*(.+?)\s*\|\s*$/;

/** The ledger rows under the "Critical journeys" heading: `[{ journey, spec, title, line }]`. */
export function parseLedger(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === SECTION);
  if (start === -1) return null;
  const rows = [];
  for (let at = start + 1; at < lines.length && !/^##\s/.test(lines[at]); at += 1) {
    const match = lines[at].match(ROW);
    if (match) rows.push({ journey: match[1], spec: match[2], title: match[3], line: at + 1 });
  }
  return rows;
}

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * How the spec source declares `title`: `"test"`, `"skipped"` (`.skip`/`.fixme`), or `null`
 * when no `test(…)` carries it as its first argument.
 */
export function findTest(source, title) {
  const declared = new RegExp(
    `\\btest(\\.(?:skip|fixme|only|fail|slow))?\\(\\s*(["'\`])${escapeForRegExp(title)}\\2`,
  );
  const match = source.match(declared);
  if (!match) return null;
  return /^\.(?:skip|fixme)$/.test(match[1] ?? "") ? "skipped" : "test";
}

/** Every problem with the ledger, given a reader for spec files (`null` when absent). */
export function auditLedger(markdown, readSpec) {
  const rows = parseLedger(markdown);
  if (rows === null) return [`${LEDGER}: no "${SECTION}" section.`];
  if (rows.length === 0) return [`${LEDGER}: the "${SECTION}" table has no rows.`];
  const problems = [];
  for (const { journey, spec, title, line } of rows) {
    const source = readSpec(spec);
    const where = `${LEDGER}:${line} (${journey})`;
    if (source === null) {
      problems.push(`${where}: ${spec} does not exist.`);
      continue;
    }
    const found = findTest(source, title);
    if (found === null) {
      problems.push(`${where}: no test titled "${title}" in ${spec}.`);
    } else if (found === "skipped") {
      problems.push(`${where}: "${title}" in ${spec} is skipped.`);
    }
  }
  return problems;
}

function main() {
  const root = process.cwd();
  const markdown = readFileSync(path.join(root, LEDGER), "utf8");
  const readSpec = (spec) => {
    const file = path.join(root, spec);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  const problems = auditLedger(markdown, readSpec);
  if (problems.length > 0) {
    console.error(
      `Critical journeys without their test:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    console.error(
      "A critical journey keeps a browser test. If the test was renamed or moved, update its row in the same change; if the journey itself is gone, delete the row and say why in the PR.",
    );
    process.exit(1);
  }
  console.log(`critical-journeys: ${parseLedger(markdown).length} journeys, each with its test`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
