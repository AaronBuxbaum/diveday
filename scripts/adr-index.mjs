#!/usr/bin/env node
// Prints the ADR index: one row per ADR — its id and the first five words of its title, struck
// through with the successor beside it when superseded — sorted by id. Nothing stores it: a table
// that every new ADR appended to conflicted whenever two stacked layers each added a record.
//
//   node scripts/adr-index.mjs
//
// Two columns and five words because the index is what a reviewer is pointed at: with whole
// titles, statuses and successors it reached 6,244 words (about 8k tokens) by 2026-10-11, the
// heaviest "read this first" in the repository. The id is the lookup key and the file name
// (`<id>.md`), so it is written bare rather than as a link that spells it twice.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DECISIONS_DIR = "docs/architecture/decisions";

/** Every ADR file name in the directory, sorted: everything but the README and the template. */
export function adrFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md" && name !== "0000-template.md")
    .sort();
}

/**
 * `{ id, title, status, supersededBy }` from one ADR's text. The successor is the first id in
 * `known` that the status line names, linked or bare — status lines are prose ("Superseded on
 * 2026-09-20 by …"), so a date is never mistaken for an id.
 */
export function adrSummary(filename, contents, known = new Set()) {
  const id = filename.replace(/\.md$/, "");
  const title = contents.match(/^#\s+\S+\s+[—-]\s+(.+)$/m)?.[1]?.trim() ?? "";
  const statusLine = contents.match(/^- \*\*Status:\*\*\s+([^\n]+)$/m)?.[1]?.trim() ?? "";
  const status = statusLine.match(/^(Proposed|Accepted|Deprecated|Superseded)/)?.[1] ?? "";
  const supersededBy =
    status === "Superseded"
      ? ((statusLine.match(/\d{4}(?:\d{4})?-[a-z0-9-]+/g) ?? []).find((token) =>
          known.has(token),
        ) ?? "")
      : "";
  return { id, title, status, supersededBy };
}

const cell = (text) => text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

export const TITLE_WORDS = 5;

/** The first TITLE_WORDS words of a title, with an ellipsis when that cut something. */
export function shortTitle(title) {
  const words = title.split(/\s+/).filter(Boolean);
  return words.length > TITLE_WORDS ? `${words.slice(0, TITLE_WORDS).join(" ")}…` : words.join(" ");
}

/** The Decision cell: the short title, marked when the record no longer stands as written. */
function decisionCell({ title, status, supersededBy }) {
  const short = cell(shortTitle(title));
  if (status === "Superseded") {
    return supersededBy ? `~~${short}~~ → ${supersededBy}` : `~~${short}~~`;
  }
  if (status === "Deprecated") return `~~${short}~~ (deprecated)`;
  if (status === "Proposed") return `${short} (proposed)`;
  return short;
}

/** The table, header included, one line per ADR. */
export function indexTable(summaries) {
  const rows = summaries.map((summary) => `| ${summary.id} | ${decisionCell(summary)} |`);
  return ["| ADR | Decision |", "| --- | --- |", ...rows].join("\n");
}

/** The index, read from the tree at `root`. */
export function indexFor(root) {
  const dir = path.join(root, DECISIONS_DIR);
  const files = adrFiles(dir);
  const known = new Set(files.map((name) => name.replace(/\.md$/, "")));
  return indexTable(
    files.map((name) => adrSummary(name, readFileSync(path.join(dir, name), "utf8"), known)),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(indexFor(path.join(path.dirname(fileURLToPath(import.meta.url)), "..")));
}
