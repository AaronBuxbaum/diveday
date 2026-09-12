import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  findIssueProblems,
  LABEL,
  PARKED_LABEL,
  REQUIRED_SECTIONS,
  touchedPathExists,
  WAITING_LABEL,
} from "./check-follow-ups.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * **The door onto the follow-up tracker that cannot file a malformed issue.**
 *
 * A `needs-triage` issue in the wrong shape fails `check:follow-ups`, which runs
 * inside every pull request's `pnpm check` — so one bad body reddens
 * `Repository safeguards` on *every open pull request in the repository at
 * once*, on branches whose diffs could not have caused it, until somebody edits
 * the issue by hand. That happened four times on 2026-09-04 alone (#1339,
 * #1351, #1352 and #1356 itself), from four different sessions, every one with
 * good content and only a format problem, each fixed mid-PR by a session that
 * had nothing to do with it.
 *
 * `--body` on `check-follow-ups.mjs` closed half the gap: an agent can check a
 * draft before filing. This closes the other half — the draft it checks is
 * composed here rather than typed, so the format cannot be got wrong in the
 * first place. The caller passes the four sections as arguments and never types
 * a `##`, which is what puts #1356's own trap (an issue about this format that
 * could not describe the format) out of reach from this door.
 *
 * Deliberately not a second set of rules: the body goes straight back through
 * `findIssueProblems`, the same function `pnpm check:follow-ups` runs, and
 * `gh` is never spawned when that function has anything to say. Refusing is the
 * whole point; filing is what it does when it has nothing left to refuse.
 */

const VALUE_FLAGS = {
  "--title": "title",
  "--kind": "kind",
  "--effort": "effort",
  "--touches": "touches",
  "--noticed": "noticed",
  "--why": "why",
  "--proposed": "proposed",
  "--prompt": "prompt",
  "--waiting-on": "waitingOn",
  "--parked": "parked",
};
/** The four prose flags name a file to read, or `-` for stdin. */
const FILE_FLAGS = new Set(["--noticed", "--why", "--proposed", "--prompt"]);
const REQUIRED_FLAGS = [
  "--title",
  "--kind",
  "--effort",
  "--touches",
  "--noticed",
  "--why",
  "--proposed",
  "--prompt",
];

/** Which composed section each required heading is written from. A heading with
 *  no field here is a heading this helper cannot write, and the render throws
 *  rather than emitting a body that the guard would then reject at the door. */
const SECTION_FIELDS = new Map([
  ["What I noticed", "noticed"],
  ["Why it isn't already done", "why"],
  ["Proposed change", "proposed"],
  ["Prompt", "prompt"],
]);

/**
 * Strict in exactly the way `parseDraftArgs` is strict, and for the same reason:
 * this tool exists to catch a mistake before it costs every open pull request an
 * hour, so an invocation that quietly files something other than what was meant
 * is the one outcome worth engineering against. Anything unrecognised, repeated,
 * positional, or missing its value is an error — including a value that is
 * itself a flag, so `--kind --effort M` reports a missing kind rather than
 * filing an issue whose `Kind:` is `--effort`.
 *
 * `--label` is the one repeatable flag (it is a set), and `needs-triage` is
 * always in that set whether or not it was named.
 *
 * Returns `{ error }` instead of exiting, so the tests can read the message.
 */
export function parseFileArgs(argv) {
  const values = {};
  const labels = [];
  let dryRun = false;
  const seen = new Set();
  for (let at = 0; at < argv.length; at += 1) {
    const name = argv[at];
    if (name === "--dry-run") {
      if (dryRun) return { error: `file-follow-up: ${name} given twice` };
      dryRun = true;
      continue;
    }
    const isLabel = name === "--label";
    if (!isLabel && !(name in VALUE_FLAGS)) {
      return {
        error: `file-follow-up: unrecognised argument \`${name}\` — see docs/agents/issue-tracker.md's Filing a follow-up section for the flags`,
      };
    }
    if (!isLabel && seen.has(name)) return { error: `file-follow-up: ${name} given twice` };
    seen.add(name);
    const value = argv[at + 1];
    if (
      value === undefined ||
      value === "--dry-run" ||
      value === "--label" ||
      value in VALUE_FLAGS
    ) {
      return { error: `file-follow-up: ${name} needs a value` };
    }
    at += 1;
    if (isLabel) labels.push(value);
    else values[VALUE_FLAGS[name]] = value;
  }

  const missing = REQUIRED_FLAGS.filter((name) => values[VALUE_FLAGS[name]] === undefined);
  if (missing.length > 0) {
    return { error: `file-follow-up: missing required ${missing.join(", ")}` };
  }
  // One stdin, so at most one flag may read from it.
  const fromStdin = [...FILE_FLAGS].filter((name) => values[VALUE_FLAGS[name]] === "-");
  if (fromStdin.length > 1) {
    return {
      error: `file-follow-up: only one flag can read stdin, and ${fromStdin.join(", ")} all do`,
    };
  }

  const applied = new Set([LABEL, ...labels]);
  // The prose and the label have to agree, and only one direction of that is
  // caught downstream. `--label waiting-on-external` with no `--waiting-on` is
  // refused by `findIssueProblems`, which demands the line. The reverse is
  // silent: a body that *says* it is waiting on somebody, filed without the
  // label, reads as waiting to a human and counts as attention owed to every
  // machine — `pnpm gates`, the persona walk's brake (#1497), and the guard's
  // own "waiting on somebody else" tally all read the label, never the line.
  // This door knows the intent, because the caller typed it.
  for (const [field, label, flag] of [
    ["waitingOn", WAITING_LABEL, "--waiting-on"],
    ["parked", PARKED_LABEL, "--parked"],
  ]) {
    if (values[field] !== undefined && !applied.has(label)) {
      return {
        error: `file-follow-up: ${flag} writes a line only the \`${label}\` label gives meaning — add \`--label ${label}\`, or drop ${flag}`,
      };
    }
  }

  return {
    ...values,
    touches: values.touches
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean),
    labels: [...applied],
    dryRun,
  };
}

/**
 * The body, in the shape `docs/agents/issue-tracker.md` documents and
 * `findIssueProblems` enforces. Pure, so a test can assert the composed result
 * passes the guard without a tracker, a network, or a filesystem.
 */
export function renderFollowUpBody(fields) {
  const lines = [];
  if (fields.waitingOn) lines.push(`**Waiting on:** ${fields.waitingOn}`);
  if (fields.parked) lines.push(`**Parked:** ${fields.parked}`);
  lines.push(`**Kind:** ${fields.kind}`);
  lines.push(`**Effort:** ${fields.effort}`);
  lines.push(`**Touches:** ${fields.touches.map((token) => `\`${token}\``).join(", ")}`);

  for (const heading of REQUIRED_SECTIONS) {
    const field = SECTION_FIELDS.get(heading);
    if (!field) {
      throw new Error(
        `file-follow-up: no section text for required heading “${heading}” — teach SECTION_FIELDS about it, or this helper files bodies the guard rejects`,
      );
    }
    const text = String(fields[field] ?? "").trim();
    lines.push("", `## ${heading}`, "");
    if (heading === "Prompt") lines.push("```text", text, "```");
    else lines.push(text);
  }
  return `${lines.join("\n")}\n`;
}

/** `-` is stdin; anything else is a path, resolved from where the caller stands. */
async function readSection(root, spec) {
  if (spec === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(path.resolve(root, spec), "utf8");
}

async function main() {
  const parsed = parseFileArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  const root = process.cwd();
  const sections = {};
  for (const flag of FILE_FLAGS) {
    const field = VALUE_FLAGS[flag];
    try {
      sections[field] = await readSection(root, parsed[field]);
    } catch (error) {
      console.error(`file-follow-up: could not read ${flag} ${parsed[field]} — ${error.message}`);
      process.exit(1);
    }
  }

  const body = renderFollowUpBody({ ...parsed, ...sections });
  const { problems, touched } = findIssueProblems(
    { number: 0, title: parsed.title, body },
    {
      waiting: parsed.labels.includes(WAITING_LABEL),
      parked: parsed.labels.includes(PARKED_LABEL),
    },
  );
  // Fatal here, where `--body`'s pre-flight only warns. That mode checks a draft
  // somebody may still edit; this one is about to put the entry in front of
  // every other session's `pnpm check`, and a path that is not in the tree today
  // reddens all of them the moment it lands.
  for (const token of touched) {
    if (await touchedPathExists(root, token)) continue;
    problems.push(
      `**Touches:** “${token}” is not in this tree — name a path that exists on main, and name an arriving one in prose instead.`,
    );
  }

  if (problems.length > 0) {
    console.error(
      `file-follow-up: DID NOT FILE — the composed body does not pass \`check:follow-ups\`:\n${problems
        .map((problem) => `  - ${problem.replace(/^#0 “[^”]*”: /, "")}`)
        .join("\n")}`,
    );
    console.error(
      "Filing it anyway would fail `Repository safeguards` on every open pull request in the repository until somebody edited the issue by hand. See docs/agents/issue-tracker.md's Filing a follow-up section.",
    );
    process.exit(1);
  }

  if (parsed.dryRun) {
    console.log(body);
    return;
  }

  const result = runBounded(
    "gh",
    [
      "issue",
      "create",
      "--label",
      parsed.labels.join(","),
      "--title",
      parsed.title,
      "--body",
      body,
    ],
    { cwd: root, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.ghCli },
  );
  if (result.status !== 0) {
    console.error(
      `file-follow-up: \`gh issue create\` failed — ${String(result.stderr ?? "").trim()}`,
    );
    process.exit(1);
  }
  console.log(`file-follow-up: filed ${String(result.stdout ?? "").trim()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
