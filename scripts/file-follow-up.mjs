import { appendFileSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import {
  findIssueProblems,
  INBOX_CEILING,
  inboxProblem,
  LABEL,
  nearDuplicate,
  PARKED_LABEL,
  QUESTION_LABEL,
  REQUIRED_SECTIONS,
  TOUCHED_TIMEOUT,
  touchedPathExists,
  unverifiedTouchedProblem,
  WAITING_LABEL,
} from "./check-follow-ups.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { tracker } from "./tracker.mjs";

/**
 * **The door onto the follow-up tracker that cannot file a malformed issue.**
 *
 * A `needs-triage` issue in the wrong shape fails `check:follow-ups` for
 * everyone until somebody edits the issue by hand. While that check ran inside
 * every pull request's `pnpm check` (until 2026-10-07; it is scheduled now),
 * one bad body reddened *every open pull request in the repository at once*. That happened four times on 2026-09-04 alone (#1339,
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
 * nothing reaches GitHub (through `scripts/tracker.mjs`) when that function has anything to say. Refusing is the
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
  "--over-quota": "overQuota",
};

/**
 * The filing quota: at most FOLLOW_UP_QUOTA issues from one clone in QUOTA_WINDOW_HOURS.
 * Backlog sweeps filed 54 `needs-triage` issues in three bursts on 2026-10-09 and 2026-10-10 and
 * none was triaged: a queue written faster than anyone reads it is no memory at all. The eleventh
 * filing is refused unless `--over-quota "<why>"` says why this one cannot wait.
 *
 * **The ledger is the clone's, not the checkout's.** Until 2026-10-13 it was
 * `<checkout>/.claude/.follow-up-log`, so a stack of eight layers in eight worktrees had eight
 * quotas, and one day filed 128 issues (2026-10-13 re-review, item 1). It now lives in
 * `git rev-parse --git-common-dir`, which every worktree of a clone shares: a stack, built in
 * however many worktrees, is counted once. Each line is `<ISO time>\t<branch>`, so the refusal
 * can say who filed.
 */
export const FOLLOW_UP_QUOTA = 10;
export const QUOTA_WINDOW_HOURS = 12;
export const QUOTA_LEDGER_NAME = "diveday-follow-up-log";
/** Points the ledger somewhere else; the tests use it so they never write the real one. */
export const QUOTA_LEDGER_ENV = "DIVEDAY_FOLLOW_UP_LEDGER";

/**
 * Where the ledger lives: `$DIVEDAY_FOLLOW_UP_LEDGER`, else
 * `<git common dir>/diveday-follow-up-log`, else (no git) the gitignored
 * `<root>/.claude/.follow-up-log`. `git` is injectable for the tests.
 */
export function ledgerPath(root, { env = process.env, git = gitCommonDir } = {}) {
  if (env[QUOTA_LEDGER_ENV]) return path.resolve(root, env[QUOTA_LEDGER_ENV]);
  const common = git(root);
  return common
    ? path.join(path.resolve(root, common), QUOTA_LEDGER_NAME)
    : path.join(root, ".claude/.follow-up-log");
}

function gitCommonDir(root) {
  try {
    return (
      readBounded("git", ["rev-parse", "--git-common-dir"], {
        cwd: root,
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/** How many ledger lines (`<ISO>` or `<ISO>\t<branch>`) fall in the window ending `now`. */
export function filedInWindow(stamps, now = new Date()) {
  const since = now.getTime() - QUOTA_WINDOW_HOURS * 3_600_000;
  return stamps.filter((stamp) => {
    const at = Date.parse(String(stamp).split("\t")[0]);
    return Number.isFinite(at) && at >= since && at <= now.getTime();
  }).length;
}

function readLedger(file) {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function currentBranch(root) {
  try {
    return readBounded("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
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

  // A question is a decision only a human can make: it goes straight to the human queue, not
  // into the agent inbox where 31 of 128 sat on 2026-10-13.
  const applied = new Set([values.kind === "question" ? QUESTION_LABEL : LABEL, ...labels]);
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
 * A last look at the composed body before it is filed. Coarse on purpose:
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
  const requested = path.resolve(root, spec);
  // **The containment check is on the link target, not on the name.** A lexical
  // `path.resolve` says `<checkout>/notes.md` is inside the checkout even when
  // it is a symlink to `~/.aws/credentials`, and `readFile` follows it — so the
  // first version of this guard could still be walked straight past, which is
  // the whole primitive it exists to close (`sourcery-ai` on PR 1743,
  // reproduced before fixing). `realpath` first, then decide.
  let resolved;
  try {
    resolved = realpathSync(requested);
  } catch {
    // No such file, or a dangling link. Not this check's refusal to make: fall
    // through to `readFile` so the caller reports "could not read" with the
    // flag and the path, which is what a typo deserves.
    resolved = requested;
  }
  if (!within(root, resolved) && !within(realTmpDir(), resolved)) {
    throw new Error(
      `“${spec}” resolves outside the checkout and the scratch directory (${realTmpDir()}), and this body goes to a public tracker — draft the prose in one of those, or pipe it in as “-”`,
    );
  }
  // Both the name and the target: a link called `notes.md` pointing at an env
  // file is refused by the target, and an env file reached directly is refused
  // by the name even on a filesystem where `realpath` told us nothing.
  if (SECRET_SHAPED_FILE.test(requested) || SECRET_SHAPED_FILE.test(resolved)) {
    throw new Error(
      `“${spec}” is an env file, and this body goes to a public tracker — put the prose in a file of its own`,
    );
  }
  return readFile(resolved, "utf8");
}

/**
 * **`--papercut <slug>`: the other door, into the repo instead of the tracker.** A papercut is
 * friction with the tooling, not work for the product (docs/agents/papercuts.md), and it is four
 * lines in `docs/agents/papercuts/<date>-<slug>.md`. The per-prompt line asks for one when a hook
 * has refused the same rule three times (`scripts/session-context.mjs`); this writes it, so the
 * ask is one command rather than a file to shape by hand. Through the week of 2026-10-09 the log
 * recorded nothing while 90 CI jobs failed.
 *
 *   node scripts/file-follow-up.mjs --papercut <slug> --project <area> --symptom "<text>" --fix "<text>"
 */
const PAPERCUT_FLAGS = {
  "--papercut": "slug",
  "--project": "project",
  "--symptom": "symptom",
  "--fix": "fix",
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PAPERCUT_DIR = "docs/agents/papercuts";

export function parsePapercutArgs(argv) {
  const values = {};
  let dryRun = false;
  for (let at = 0; at < argv.length; at += 1) {
    const name = argv[at];
    if (name === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!(name in PAPERCUT_FLAGS)) {
      return {
        error: `file-follow-up --papercut: unrecognised argument \`${name}\` — it takes --papercut <slug> --project <area> --symptom "<text>" --fix "<text>"`,
      };
    }
    if (values[PAPERCUT_FLAGS[name]] !== undefined) {
      return { error: `file-follow-up --papercut: ${name} given twice` };
    }
    const value = argv[at + 1];
    if (value === undefined || value in PAPERCUT_FLAGS || value === "--dry-run") {
      return { error: `file-follow-up --papercut: ${name} needs a value` };
    }
    values[PAPERCUT_FLAGS[name]] = value;
    at += 1;
  }
  const missing = Object.entries(PAPERCUT_FLAGS)
    .filter(([, field]) => !String(values[field] ?? "").trim())
    .map(([flag]) => flag);
  if (missing.length > 0) {
    return { error: `file-follow-up --papercut: missing ${missing.join(", ")}` };
  }
  if (!SLUG.test(values.slug)) {
    return {
      error: `file-follow-up --papercut: “${values.slug}” is not a slug — lowercase words joined by hyphens`,
    };
  }
  return { ...values, dryRun };
}

/** The four lines docs/agents/papercuts.md asks for, each on one line however long. */
export function renderPapercut({ date, project, symptom, fix }) {
  const line = (text) => String(text).replace(/\s+/g, " ").trim();
  return `Date: ${date}\nProject: ${line(project)}\nSymptom: ${line(symptom)}\nFix: ${line(fix)}\n`;
}

function papercutMain(argv) {
  const parsed = parsePapercutArgs(argv);
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }
  const date = new Date().toISOString().slice(0, 10);
  const text = renderPapercut({ ...parsed, date });
  if (SECRET_SHAPED_TEXT.some((pattern) => pattern.test(text))) {
    console.error(
      "file-follow-up --papercut: DID NOT WRITE — the text looks like it carries a credential, and the repository is public.",
    );
    process.exit(1);
  }
  const relative = `${PAPERCUT_DIR}/${date}-${parsed.slug}.md`;
  if (parsed.dryRun) {
    console.log(`${relative}\n${text}`);
    return;
  }
  try {
    // `wx`: an existing entry is never overwritten. Two sessions hitting the same papercut on
    // one day is the signal the papercuts doc asks for: pick another slug.
    writeFileSync(path.join(process.cwd(), relative), text, { flag: "wx" });
  } catch (error) {
    console.error(
      error.code === "EEXIST"
        ? `file-follow-up --papercut: ${relative} exists — someone hit this today too; read it, and pick another slug if yours is different`
        : `file-follow-up --papercut: could not write ${relative} — ${error.message}`,
    );
    process.exit(1);
  }
  console.log(`file-follow-up: wrote ${relative}; commit it with your change.`);
}

async function main() {
  if (process.argv.includes("--papercut")) {
    papercutMain(process.argv.slice(2));
    return;
  }
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
  // Fatal here, and fatal in `--body`'s pre-flight since 2026-09-12 (issue
  // #1761) — with one difference: that door takes
  // `--allow-unresolved-touches` for a draft whose branch legitimately adds the
  // path, and this one does not, because it is about to put the entry in front
  // of every other session's `pnpm check` and a path that is not in the tree
  // today reddens all of them the moment it lands.
  for (const token of touched) {
    const outcome = await touchedPathExists(root, token);
    if (outcome === true) continue;
    // The one place a timeout is not accepted. The guard reading an issue that
    // is already filed shrugs a slow walk off; this is the door about to make
    // one public, and "I could not check" is not "it is fine".
    if (outcome === TOUCHED_TIMEOUT) {
      problems.push(unverifiedTouchedProblem(token));
      continue;
    }
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

  const ledger = ledgerPath(root);
  const recent = filedInWindow(readLedger(ledger));
  if (recent >= FOLLOW_UP_QUOTA && !parsed.overQuota) {
    console.error(
      `file-follow-up: DID NOT FILE — ${recent} follow-ups were filed from this clone (every worktree, so a whole stack) in the last ${QUOTA_WINDOW_HOURS} hours, and the quota is ${FOLLOW_UP_QUOTA}. Do the most valuable of what is left, fold related notes into one issue, or say in your hand-off what you did not file. If this one cannot wait, pass --over-quota "<why>". See docs/agents/issue-tracker.md's Filing a follow-up section.`,
    );
    process.exit(1);
  }

  // One read of every open issue serves both refusals below. It fails open: the scheduled
  // `check:follow-ups` still sees the inbox, and a tracker hiccup should not cost a filing.
  let open = null;
  try {
    open = tracker().listIssues({ state: "open" });
  } catch (error) {
    console.error(
      `file-follow-up: could not read the open issues (${error.message}); filing without the duplicate and inbox checks.`,
    );
  }
  if (open) {
    const twin = nearDuplicate(parsed.title, open);
    if (twin) {
      console.error(
        `file-follow-up: DID NOT FILE — #${twin.number} “${twin.title}” is open and starts with the same words. Add this to it as a comment, or fold both into one issue; if it really is a different item, give it a title that says how.`,
      );
      process.exit(1);
    }
    const inbox = open.filter((issue) =>
      (issue.labels ?? []).some((label) => label.name === LABEL),
    ).length;
    if (parsed.labels.includes(LABEL) && inboxProblem(inbox) && !parsed.overQuota) {
      console.error(
        `file-follow-up: DID NOT FILE — ${inbox} issues are open under label:${LABEL}, over the ceiling of ${INBOX_CEILING}. Name what you did not file in your hand-off instead; if this one cannot wait, pass --over-quota "<why>".`,
      );
      process.exit(1);
    }
  }

  let filed;
  try {
    filed = tracker().createIssue({ title: parsed.title, body, labels: parsed.labels });
  } catch (error) {
    console.error(`file-follow-up: filing failed — ${error.message}`);
    process.exit(1);
  }
  try {
    appendFileSync(ledger, `${new Date().toISOString()}\t${currentBranch(root)}\n`);
  } catch {
    // An unwritable ledger loses a count, never an issue.
  }
  console.log(`file-follow-up: filed ${filed.url || `#${filed.number}`}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
