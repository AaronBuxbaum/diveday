// Every ADR is well-formed, a new one is short, and the README's index matches the files.
//
// The word cap: an ADR is read whole by every session a skill or a link sends to it, at about
// 1.3k tokens for the corpus average. The 20 written between 2026-10-01 and 2026-10-10 averaged
// 1,021 words (the longest 1,918), because the incident narrative, the measurements and the
// rejected drafts went in with the decision. Those belong in the PR, an issue or `docs/`, linked
// from Context. So an ADR whose id is dated after CAP_FROM may hold at most WORD_CAP words,
// HTML comments not counted; the older corpus is left as it is.
//
// The index: `docs/architecture/decisions/README.md` carries a generated table (id, title,
// status, superseded-by), written by `node scripts/adr-index.mjs --write`. Before it a session
// found an ADR with `ls | grep`.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { expectedReadme } from "./adr-index.mjs";

/** Ids dated after this day are capped. */
export const CAP_FROM = "20261010";
export const WORD_CAP = 500;

const historicalId = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const parallelId = /^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validStatuses = new Set(["Proposed", "Accepted", "Deprecated", "Superseded"]);
const requiredSections = ["Context", "Decision", "Alternatives considered", "Consequences"];

/** Words in an ADR as a reader meets them: HTML comments are guidance, not the record. */
export function adrWords(contents) {
  const text = contents.replace(/<!--[\s\S]*?-->/g, " ").trim();
  return text ? text.split(/\s+/).length : 0;
}

/** Whether `id` is new enough to be held to the cap. */
export function isCapped(id) {
  return parallelId.test(id) && id.slice(0, 8) > CAP_FROM;
}

/** Every problem with one ADR file, as `filename: …` strings, and the id duplicates key on. */
export function adrProblems(filename, contents) {
  const id = filename.slice(0, -3);
  const failures = [];
  const headingId = contents.match(/^#\s+([^\s]+)\s+[—-]\s+.+$/m)?.[1];
  const expectedHeadingId = historicalId.test(id) ? id.slice(0, 4) : id;
  const status = contents.match(/^- \*\*Status:\*\*\s+([^\n]+)$/m)?.[1]?.trim();

  if (!historicalId.test(id) && !parallelId.test(id)) {
    failures.push(`${filename}: id must be NNNN-slug (historical) or YYYYMMDD-slug (new)`);
  }
  if (headingId !== expectedHeadingId) {
    failures.push(`${filename}: heading id must be ${expectedHeadingId}`);
  }
  if (!status || ![...validStatuses].some((candidate) => status.startsWith(candidate))) {
    failures.push(`${filename}: status must begin with ${[...validStatuses].join(", ")}`);
  }
  if (!/^- \*\*Date:\*\*\s+\d{4}-\d{2}-\d{2}$/m.test(contents)) {
    failures.push(`${filename}: missing ISO Date metadata`);
  }
  for (const section of requiredSections) {
    if (!contents.includes(`## ${section}`))
      failures.push(`${filename}: missing section “${section}”`);
  }
  if (isCapped(id)) {
    const words = adrWords(contents);
    if (words > WORD_CAP) {
      failures.push(
        `${filename}: ${words} words; an ADR dated after ${CAP_FROM} holds at most ${WORD_CAP}. Keep the decision and its reasons; move the incident narrative, measurements and rejected drafts to the PR, an issue or docs/, linked from Context`,
      );
    }
  }
  return { id: expectedHeadingId, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const directory = path.join(root, "docs/architecture/decisions");
  const entries = (await readdir(directory)).filter(
    (name) => name.endsWith(".md") && name !== "README.md" && name !== "0000-template.md",
  );
  const ids = new Map();
  const failures = [];

  for (const filename of entries) {
    const { id, failures: found } = adrProblems(
      filename,
      await readFile(path.join(directory, filename), "utf8"),
    );
    failures.push(...found);
    ids.set(id, [...(ids.get(id) ?? []), filename]);
  }
  for (const [id, filenames] of ids) {
    if (filenames.length > 1) failures.push(`duplicate ADR id ${id}: ${filenames.join(", ")}`);
  }

  const { readme, expected } = expectedReadme(root);
  if (expected === null) {
    failures.push(
      "README.md: the generated index block (adr-index:start … adr-index:end) is missing",
    );
  } else if (expected !== readme) {
    failures.push(
      "README.md: the index table is stale — run `node scripts/adr-index.mjs --write` (on a merge conflict in the table, take either side and run it again)",
    );
  }

  if (failures.length > 0) {
    console.error(`ADR validation failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
    process.exit(1);
  }

  console.log(`adrs: ${entries.length} records valid, index current`);
}
