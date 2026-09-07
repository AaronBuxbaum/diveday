#!/usr/bin/env node
// A `PreToolUse` hook on `Read` that turns AGENTS.md's "Context economy" section from a
// remembered rule into a mechanical one.
//
// Two shapes are refused, and each refusal names the cheaper form:
//
//  1. Reading a generated artifact whole — `pnpm-lock.yaml`, a Drizzle `snapshot.json`,
//     anything under `.next/`, `playwright-report/` or `test-results/`. None of these is
//     source; every one is thousands of lines a session pays for and does not read. The
//     rule already allows "diagnosing a specific failure in that artifact", and that is
//     still allowed — through Grep, which is what a *specific* lookup is. A migration's
//     `migration.sql` stays readable, because the schema-change skill asks for the generated
//     SQL to be reviewed once.
//
//  2. A whole-file read of a large source file. Claude's `Read` returns up to 2,000 lines
//     when no range is given, so `src/db/schema.ts` (8,700 lines) costs roughly 25,000
//     tokens per open and answers a question that Grep answers in fifty. AGENTS.md says
//     "locate symbols with search and read the narrow surrounding range instead of opening
//     large files"; this makes the range the default path for any file over LARGE_FILE_LINES.
//     Passing `offset` or `limit` is the whole escape hatch: an explicit range is an explicit
//     decision, and the guard never second-guesses one.
//
// Markdown is exempt from the size rule (a document is read to be read; it has no symbol to
// search for), and so is anything outside the repository — `node_modules/next/dist/docs/` is
// exactly what AGENTS.md asks a session to read before framework work.
//
// Same contract and same posture as `guard-bash.mjs`: JSON on stdin, exit 2 with the reason on
// stderr to refuse, and **fail open** on anything it does not understand.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A whole-file read past this many lines is refused without an explicit range. */
export const LARGE_FILE_LINES = 600;

/** Generated artifacts that are never read whole, with the reason each one is refused. */
const GENERATED = [
  {
    match: (relative) => relative === "pnpm-lock.yaml",
    why: "the lockfile is generated and is read by pnpm, not by people",
  },
  {
    match: (relative) => relative.startsWith("drizzle/") && !relative.endsWith("migration.sql"),
    why: "`drizzle/` is generated from `src/db/schema.ts`, which is the source of truth for the schema (the one exception, a migration's own `migration.sql`, stays readable)",
  },
  {
    match: (relative) => relative.startsWith(".next/"),
    why: "`.next/` is build output",
  },
  {
    match: (relative) =>
      relative.startsWith("playwright-report/") || relative.startsWith("test-results/"),
    why: "a Playwright report is read for one failure's `error-context.md` or one trace, never whole",
  },
];

/** Extensions the size rule leaves alone: documents, and formats with nothing to grep for. */
const SIZE_EXEMPT = new Set([
  ".md",
  ".mdx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
]);

function relativeToRepo(filePath, root) {
  if (typeof filePath !== "string" || !filePath) return null;
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (relative.split(path.sep).includes("node_modules")) return null;
  return relative.split(path.sep).join("/");
}

function countLines(absolute) {
  const text = readFileSync(absolute, "utf8");
  if (!text) return 0;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

/**
 * The reason this read is refused, or null. Pure enough for the tests: `lineCount` is
 * injectable so a fixture never has to write an 8,700-line file to disk.
 */
export function violationFor(toolInput, { root = ROOT, lineCount = countLines } = {}) {
  const relative = relativeToRepo(toolInput?.file_path, root);
  if (!relative) return null;

  for (const artifact of GENERATED) {
    if (artifact.match(relative)) {
      return (
        `\`${relative}\` is not read whole — ${artifact.why} (AGENTS.md, "Context economy"). ` +
        `For a specific lookup, Grep it for the line you need; a Read of the full file costs thousands of tokens and answers nothing Grep would not.`
      );
    }
  }

  const hasRange = toolInput.offset !== undefined || toolInput.limit !== undefined;
  if (hasRange) return null;
  if (SIZE_EXEMPT.has(path.extname(relative).toLowerCase())) return null;

  const absolute = path.resolve(root, relative);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return null;
  const lines = lineCount(absolute);
  if (lines <= LARGE_FILE_LINES) return null;

  return (
    `\`${relative}\` is ${lines.toLocaleString("en-US")} lines; a whole-file Read returns up to 2,000 of them at once. ` +
    `Locate what you need first — \`Grep\` for the symbol with \`-n\` (or \`Glob\` for the file) — then Read the narrow range with \`offset\`/\`limit\` ` +
    `(AGENTS.md, "Context economy"). An explicit \`offset\` or \`limit\` is always allowed; a file over ${LARGE_FILE_LINES} lines is never opened by default.`
  );
}

async function main() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;

  const parsed = JSON.parse(payload);
  if (parsed.tool_name !== "Read") return;

  const reason = violationFor(parsed.tool_input ?? {});
  if (!reason) return;

  console.error(`Refused by scripts/guard-read.mjs: ${reason}`);
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    // Fail open, always and deliberately. See the module comment.
    process.exit(0);
  }
}
