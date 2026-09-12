import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/**
 * Files whose contents may never become an issue body, whatever a caller typed.
 *
 * The generated env files are denied to the *file tools* in `.claude/settings.json`
 * for the reason AGENTS.md states in one line: secrets never enter the repo. A
 * helper that reads a path and publishes it to a public tracker is a second door
 * onto the same files, so it carries the same refusal
 * (`security-reviewer`, issue 1356).
 */
const SECRET_SHAPED_FILE = /(^|\/)\.env(\.|$)/;

/**
 * `os.tmpdir()` through `realpath`, because macOS reports `/var/folders/…`
 * while a path handed in resolves through `/private/var/folders/…`; comparing
 * the two unresolved makes a legitimate scratch file look like it is outside.
 */
function realTmpDir() {
  try {
    return realpathSync(tmpdir());
  } catch {
    return tmpdir();
  }
}

/**
 * A last look at the composed body before `gh` is spawned. Coarse on purpose:
 * it is the seatbelt under the containment check above, for the case where a
 * secret reaches a section through a file that is inside the checkout and not
 * named `.env` — a scratch note, a pasted log, a captured request.
 *
 * A false positive costs one `DID NOT FILE` and a re-run; a false negative is
 * permanent, public and indexed.
 */
const SECRET_SHAPED_TEXT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk_(live|test)_[A-Za-z0-9]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bpostgres(ql)?:\/\/[^\s/@]+:[^\s/@]+@/,
];

/** True when `child` is `parent` itself or sits under it. */
function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * `-` is stdin; anything else is a path in one of two places.
 *
 * **Why there are only two.** Without a bound this is an
 * arbitrary-file-to-public-tracker primitive: `--noticed .env.local` puts the
 * shop's Stripe key and `AUTH_SECRET` into the "What I noticed" section of a
 * GitHub issue, and `findIssueProblems` waves it through, because an env file
 * clears the word count comfortably. `../` and an absolute path read the same
 * way. This helper exists to refuse a malformed body before it is public;
 * refusing an unpublishable one is the same job (`security-reviewer`, issue
 * 1356).
 *
 * **Why it is not just the checkout.** Prose for a follow-up is drafted in a
 * session's scratchpad, which lives under the system temp directory and not in
 * the tree — that is the intended workflow, not a workaround, and narrowing to
 * the checkout would push everyone back to `--body` and the hand-typed
 * headings this door exists to replace. So: the checkout, or the temp
 * directory. A credential store in a home directory is neither.
 */
async function readSection(root, spec) {
  if (spec === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  const resolved = path.resolve(root, spec);
  if (!within(root, resolved) && !within(realTmpDir(), resolved)) {
    throw new Error(
      `“${spec}” is neither in the checkout nor in the scratch directory (${realTmpDir()}), and this body goes to a public tracker — draft the prose in one of those, or pipe it in as “-”`,
    );
  }
  if (SECRET_SHAPED_FILE.test(resolved)) {
    throw new Error(
      `“${spec}” is an env file, and this body goes to a public tracker — put the prose in a file of its own`,
    );
  }
  return readFile(resolved, "utf8");
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

  // The seatbelt under `readSection`'s containment check, read over the whole
  // composed body: a secret can reach a section through a file that is inside
  // the checkout and is not called `.env` — a scratch note, a pasted log, a
  // captured request. Coarse on purpose. A false positive costs one
  // `DID NOT FILE` and a re-run; a false negative is public and permanent.
  if (SECRET_SHAPED_TEXT.some((pattern) => pattern.test(body))) {
    problems.push(
      "the composed body looks like it carries a credential — a private key, an API key, or a connection string with a password in it. Nothing with one in it goes to a public tracker.",
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
