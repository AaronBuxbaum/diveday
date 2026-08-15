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
 *
 * The register has two rooms, and the difference is who owes the next move.
 * `docs/product/follow-ups/` is the inbox: every entry there is waiting on a
 * human's judgment, and reading one costs the reader a triage decision. The
 * `waiting/` subfolder is for entries where nobody in this repo owes anything
 * — the next move belongs to an upstream release, a third party's answer, or a
 * measurement that needs traffic we do not have yet. Re-triaging one of those
 * every week is pure noise, and the noise is what makes a reader stop opening
 * the folder at all. So a waiting entry says `**Status:** Waiting` and carries
 * a `**Waiting on:**` line naming the event and *how you would check* whether
 * it has happened — without that line the entry is indistinguishable from an
 * item nobody got round to, which is the thing this split exists to prevent.
 */

export const DIRECTORY = "docs/product/follow-ups";
/** The waiting room, relative to the repo root. Kept inside DIRECTORY on purpose:
 *  one register, two rooms, so nothing has to be linked from two places. */
export const WAITING_DIRECTORY = `${DIRECTORY}/waiting`;
const SKIP_FILES = new Set(["README.md", "TEMPLATE.md"]);
/** Subdirectories of DIRECTORY that hold entries rather than stray files. */
const SKIP_DIRECTORIES = new Set(["waiting"]);

const ENTRY_FILENAME = /^FU-(\d{8})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const VALID_STATUSES = new Set(["Open", "Parked"]);
const WAITING_STATUS = "Waiting";
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

/**
 * Is this backticked token naming a file, or something else useful?
 *
 * A `**Touches:**` line is prose, and authors reach for backticks for anything
 * code-shaped in it. `FU-20260815-gear-register-non-goal-copy-is-now-stale`
 * (arriving with #556) wrote the four bundle files *and* the message keys inside
 * them — `marketing.product.notCovered.gearSerials` — which is exactly the
 * detail that makes an entry runnable cold, and this check rejected the whole
 * entry for it. That is the check teaching authors to say less, which is
 * backwards.
 *
 * A path here always carries a `/`: every guarded root (`src`, `docs`,
 * `scripts`, `e2e`, `infra`, `drizzle`, `config`) is a directory, so a bare
 * token cannot be one. That is enough to tell a file from a dotted key without
 * guessing at extensions.
 */
function looksLikeAPath(token) {
  return token.includes("/");
}

/**
 * `src/i18n/locales/en-US/diver.json:2673` names a line, and pointing at one is
 * *more* helpful than pointing at a 3,000-line bundle — so the line number is
 * dropped for the existence check rather than the entry being refused. Handles
 * `:line` and `:line:column`, and leaves a path that merely contains a colon
 * alone.
 */
function withoutLineSuffix(token) {
  return token.replace(/:\d+(?::\d+)?$/, "");
}

/**
 * One `- **Label:** …` line, **including its wrapped continuation lines** — the
 * indented lines under it, up to the next bullet or blank line, joined with a
 * space.
 *
 * Reading only the first line is what let a broken path ship: a `**Touches:**`
 * long enough to wrap put `docs/adr/20260804-day-closeout.md` on line two,
 * where the existence check below never saw it, and the entry pointed a cold
 * reader at a file that has never existed at that path (the ADRs live in
 * `docs/architecture/decisions/`). Every field here is prose an author wraps at
 * 100 columns, so a parser that stops at the newline is reading half of them.
 */
function metadata(contents, label) {
  const match = contents.match(
    new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+(?:\\n[ \\t]+.+)*)$`, "m"),
  );
  return match?.[1].replace(/\s*\n[ \t]+/g, " ").trim() ?? null;
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
 * @param options `waiting: true` for an entry in the `waiting/` room, which
 *   swaps the status vocabulary, demands a **Waiting on:** line, and expects
 *   the prompt to name the file at its waiting-room path
 * @returns `problems` (human-readable; empty means valid) and the `touched`
 *   paths the caller checks against disk
 */
export function findEntryProblems(filename, contents, { waiting = false } = {}) {
  const problems = [];
  const say = (message) => problems.push(`${filename}: ${message}`);
  const directory = waiting ? WAITING_DIRECTORY : DIRECTORY;

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
  if (waiting) {
    if (status !== WAITING_STATUS) {
      say(
        `an entry in ${WAITING_DIRECTORY}/ must say **Status:** ${WAITING_STATUS} — move it back up a folder the moment somebody here owes the next move`,
      );
    }
    // The whole point of the waiting room is that a reader can confirm in
    // seconds whether the block has lifted. Without a named event and a way to
    // check it, an entry in here is just an entry nobody has looked at.
    const waitingOn = metadata(contents, "Waiting on");
    if (!waitingOn) {
      say(
        "a Waiting entry needs a **Waiting on:** line naming the event that unblocks it and how to check whether it has happened",
      );
    } else if (words(waitingOn) < 8) {
      say(
        "**Waiting on:** is too short to check cold — name the event *and* where a reader would look for it (a changelog, an issue, a dashboard)",
      );
    }
  } else if (!status || !VALID_STATUSES.has(status)) {
    say(
      `**Status:** must be one of ${[...VALID_STATUSES].join(", ")} (close an entry by deleting the file; an entry blocked on somebody else's release or answer belongs in ${WAITING_DIRECTORY}/)`,
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
  const backticked = touches ? [...touches.matchAll(/`([^`]+)`/g)].map((match) => match[1]) : [];
  const touched = backticked.filter(looksLikeAPath).map(withoutLineSuffix);
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
      if (!prompt.includes(`${directory}/${filename}`)) {
        say(
          `the prompt must tell the session to delete ${directory}/${filename} when the work lands`,
        );
      }
    }
  }

  for (const placeholder of PLACEHOLDERS) {
    if (contents.includes(placeholder)) say(`unfilled template text: “${placeholder}”`);
  }

  return { problems, touched };
}

/** Entry filenames in one room, sorted; `[]` when the folder is absent. */
async function entryFilenames(root, directory) {
  let names;
  try {
    names = await readdir(path.join(root, directory));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md") && !SKIP_FILES.has(name) && !SKIP_DIRECTORIES.has(name))
    .sort();
}

/** Every problem in one room, including **Touches:** paths that are not on disk. */
async function roomProblems(root, directory, filenames, options) {
  const problems = [];
  for (const filename of filenames) {
    const contents = await readFile(path.join(root, directory, filename), "utf8");
    const result = findEntryProblems(filename, contents, options);
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
  return problems;
}

/** `, oldest raised YYYY-MM-DD` for a sorted entry list, or "" when it is empty. */
function oldestSuffix(filenames) {
  const oldest = filenames.at(0)?.slice(3, 11);
  return oldest
    ? `, oldest raised ${oldest.slice(0, 4)}-${oldest.slice(4, 6)}-${oldest.slice(6, 8)}`
    : "";
}

async function main() {
  const root = process.cwd();
  const open = await entryFilenames(root, DIRECTORY);
  const waiting = await entryFilenames(root, WAITING_DIRECTORY);

  const problems = [
    ...(await roomProblems(root, DIRECTORY, open, { waiting: false })),
    ...(await roomProblems(root, WAITING_DIRECTORY, waiting, { waiting: true })),
  ];

  if (problems.length > 0) {
    console.error(`Follow-up register:\n${problems.map((item) => `- ${item}`).join("\n")}`);
    console.error(
      `Each entry is a task a human runs cold, months later — see ${DIRECTORY}/README.md and TEMPLATE.md.`,
    );
    process.exit(1);
  }

  // Counted separately because they cost a reader different things: an open
  // entry owes them a triage decision, a waiting one owes them a glance at
  // somebody else's changelog.
  console.log(
    `follow-ups: ${open.length} open${oldestSuffix(open)}; ` +
      `${waiting.length} waiting on somebody else${oldestSuffix(waiting)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
