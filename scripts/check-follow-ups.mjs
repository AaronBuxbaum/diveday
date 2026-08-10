import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * The agent follow-up register (docs/product/follow-ups/) is only worth having if
 * every entry can be acted on cold, months later, by someone who was not in the
 * session that filed it.
 *
 * An agent finishing a change has the full picture in context and consistently
 * under-writes: "revisit the pager here", "ask about the refund window". Read a
 * week later that is a shrug, not a task — the reader has to re-derive the whole
 * finding before they can decide anything, so they don't, and the register turns
 * into a graveyard. This check enforces the mechanical half of "actionable":
 * the four sections, real prose in each, and a prompt that names real files and
 * is long enough to have said something. It cannot judge whether the prompt is
 * *good*; the README carries that instruction, and review carries the rest.
 *
 * Deliberately not enforced: how many entries exist (an inbox may be full), or
 * how old they are (aging is the human's business, not a build failure) — both
 * are reported, neither fails.
 */

export const DIRECTORY = "docs/product/follow-ups";
const SKIP_FILES = new Set(["README.md", "TEMPLATE.md"]);

const ENTRY_FILENAME = /^FU-(\d{8})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const VALID_STATUSES = new Set(["Open", "Parked"]);
const VALID_KINDS = new Set(["question", "improvement", "risk", "cleanup", "half-done"]);
const VALID_EFFORTS = new Set(["S", "M", "L"]);
const REQUIRED_SECTIONS = [
  "What I noticed",
  "Why it isn't already done",
  "Proposed change",
  "Prompt",
];
// A section this short is a placeholder, not a finding. Chosen low on purpose:
// it catches "TBD" and a one-line shrug without demanding an essay.
const MIN_SECTION_WORDS = 15;
const MIN_PROMPT_WORDS = 40;
const REPO_PATH = /(?:src|scripts|docs|e2e|infra|drizzle)\/[\w./[\]@-]+/;
// Template scaffolding that means the author copied TEMPLATE.md and stopped.
const PLACEHOLDERS = ["short-slug", "YYYY-MM-DD", "TODO", "TBD", "src/lib/example.ts"];

const straight = (text) => text.replace(/[‘’]/g, "'");
const words = (text) => text.split(/\s+/).filter(Boolean).length;

function metadata(contents, label) {
  return contents.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

/**
 * Body of one `## Heading` section, up to the next heading of any level.
 */
function section(contents, heading) {
  const normalized = straight(contents);
  const start = normalized.indexOf(`## ${straight(heading)}`);
  if (start === -1) return null;
  const afterHeading = normalized.indexOf("\n", start);
  if (afterHeading === -1) return "";
  const rest = normalized.slice(afterHeading);
  const next = rest.search(/\n#{1,6} /);
  return next === -1 ? rest : rest.slice(0, next);
}

function fencedBlocks(body) {
  return [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

/**
 * @param filename entry filename, e.g. `FU-20260808-something.md`
 * @param contents the file's markdown
 * @returns `problems` (human-readable; empty means valid) and the `touched`
 *   paths the caller checks against disk
 */
export function findEntryProblems(filename, contents) {
  const problems = [];
  const say = (message) => problems.push(`${filename}: ${message}`);

  const nameMatch = ENTRY_FILENAME.exec(filename);
  if (!nameMatch) {
    say("filename must be FU-YYYYMMDD-short-slug.md (lowercase slug, ADR-style date id)");
  }
  const id = filename.replace(/\.md$/, "");

  const heading = straight(contents).match(/^#\s+(\S+)\s+[—-]\s+(.+)$/m);
  if (!heading) {
    say("first heading must be `# FU-YYYYMMDD-slug — one-line title`");
  } else {
    if (heading[1] !== id) say(`heading id "${heading[1]}" does not match the filename`);
    if (words(heading[2]) < 3)
      say("the title should say what should happen, not just name an area");
  }

  const status = metadata(contents, "Status");
  if (!status || !VALID_STATUSES.has(status)) {
    say(
      `**Status:** must be one of ${[...VALID_STATUSES].join(", ")} (close an entry by deleting the file)`,
    );
  } else if (status === "Parked" && !metadata(contents, "Parked")) {
    say("a Parked entry needs a **Parked:** line saying what would un-park it");
  }

  const raised = metadata(contents, "Raised");
  if (!raised || !/^\d{4}-\d{2}-\d{2}\s+[—-]\s+\S/.test(raised)) {
    say("**Raised:** must be `YYYY-MM-DD — what surfaced it` (PR number, branch, or task)");
  } else if (nameMatch && raised.slice(0, 10).replace(/-/g, "") !== nameMatch[1]) {
    say("**Raised:** date disagrees with the date in the filename");
  }

  const kind = metadata(contents, "Kind");
  if (!kind || !VALID_KINDS.has(kind)) {
    say(`**Kind:** must be one of ${[...VALID_KINDS].join(", ")}`);
  }

  const effort = metadata(contents, "Effort");
  if (!effort || !VALID_EFFORTS.has(effort)) {
    say(`**Effort:** must be one of ${[...VALID_EFFORTS].join(", ")}`);
  }

  const touches = metadata(contents, "Touches");
  const touched = touches ? [...touches.matchAll(/`([^`]+)`/g)].map((match) => match[1]) : [];
  if (!touches || touched.length === 0) {
    say("**Touches:** must list at least one backticked path this work would touch");
  }

  for (const name of REQUIRED_SECTIONS) {
    const body = section(contents, name);
    if (body === null) {
      say(`missing section “${name}”`);
      continue;
    }
    if (name === "Prompt") continue;
    if (words(body) < MIN_SECTION_WORDS) {
      say(`section “${name}” is a placeholder — write it for a reader with no context`);
    }
  }

  const promptSection = section(contents, "Prompt");
  if (promptSection !== null) {
    const blocks = fencedBlocks(promptSection);
    if (blocks.length === 0) {
      say("the Prompt section needs a fenced code block holding the prompt to paste");
    } else {
      const prompt = blocks.join("\n");
      if (words(prompt) < MIN_PROMPT_WORDS) {
        say(
          `the prompt is ${words(prompt)} words — too short to brief a session that has none of your context (needs ${MIN_PROMPT_WORDS}+)`,
        );
      }
      if (!REPO_PATH.test(prompt)) {
        say("the prompt names no repo path — say which files to read and change");
      }
      if (!prompt.includes(`${DIRECTORY}/${filename}`)) {
        say(
          `the prompt must tell the session to delete ${DIRECTORY}/${filename} when the work lands`,
        );
      }
    }
  }

  for (const placeholder of PLACEHOLDERS) {
    if (contents.includes(placeholder)) say(`unfilled template text: “${placeholder}”`);
  }

  return { problems, touched };
}

async function main() {
  const root = process.cwd();
  const directory = path.join(root, DIRECTORY);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".md") && !SKIP_FILES.has(name))
    .sort();

  const problems = [];
  for (const filename of files) {
    const contents = await readFile(path.join(directory, filename), "utf8");
    const result = findEntryProblems(filename, contents);
    problems.push(...result.problems);
    for (const touched of result.touched) {
      try {
        await access(path.join(root, touched));
      } catch {
        problems.push(
          `${filename}: **Touches:** path “${touched}” does not exist — name where the work lives today`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(`Follow-up register:\n${problems.map((item) => `- ${item}`).join("\n")}`);
    console.error(
      `Each entry is a task a human runs cold, months later — see ${DIRECTORY}/README.md and TEMPLATE.md.`,
    );
    process.exit(1);
  }

  const oldest = files.at(0)?.slice(3, 11);
  const age = oldest
    ? `, oldest raised ${oldest.slice(0, 4)}-${oldest.slice(4, 6)}-${oldest.slice(6, 8)}`
    : "";
  console.log(`follow-ups: ${files.length} open${age}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
