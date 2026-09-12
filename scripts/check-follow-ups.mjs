import { access, glob, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * The agent follow-up register is a GitHub issue tracker, not a folder — every idea,
 * question, risk, or deliberately-skipped cleanup an agent leaves behind is filed as an
 * issue labelled `needs-triage` (see docs/agents/issue-tracker.md's "Filing a follow-up"
 * section). It is only worth having if every entry can be acted on cold, months later, by
 * someone who was not in the session that filed it.
 *
 * An agent finishing a change has the full picture in context and consistently
 * under-writes: "revisit the pager here", "ask about the refund window". Read a week later
 * that is a shrug, not a task — the reader has to re-derive the whole finding before they
 * can decide anything, so they don't, and the tracker fills up with issues nobody can act
 * on. This check enforces the mechanical half of "actionable": the required metadata, real
 * prose in each section, and a prompt that names real files and is long enough to have said
 * something. It cannot judge whether the prompt is *good*; docs/agents/issue-tracker.md
 * carries that instruction, and review carries the rest.
 *
 * Deliberately not enforced: how many issues are open (an inbox may be full), or how old
 * they are (aging is the human's business, not a build failure) — both are reported by
 * `pnpm gates`, neither fails here.
 *
 * `waiting-on-external` marks an issue where nobody in this repo owes the next move — an
 * upstream release, a third party's answer, a measurement that needs traffic we do not have
 * yet. That entry says `**Waiting on:**` naming the event and *how you would check* whether
 * it has happened, without which it is indistinguishable from an issue nobody got round to.
 * `parked` marks one a human has read and deliberately deferred; it needs a `**Parked:**`
 * line saying what would un-park it. Both are additional labels alongside `needs-triage`,
 * not replacements for it.
 *
 * **This is the one check in `pnpm check:repo` that makes a network call.** `gh issue list`
 * needs GitHub reachable and authenticated (see .github/workflows/ci.yml's `repo-safeguards`
 * job for the token it runs under in CI). check-repo.mjs's other checks are all local,
 * static passes for a reason — a flaky network dependency in the commit gate is exactly the
 * class of failure this repo refuses to tolerate in e2e (`pnpm check:e2e-hygiene`) — so a
 * `gh` call that cannot complete is not a content problem and does not fail the build: it
 * prints a warning and exits `SKIPPED_EXIT`. A `gh` call that *does* complete and returns
 * malformed content still fails, same as always.
 *
 * **Failing open is not the same as passing, and the runner has to be able to tell.** Until
 * 2026-08-28 this exited 0 on an unreachable `gh`, so `check-repo.mjs` — which labels a check
 * by its exit code alone — printed it under the same `ok` header as a check that had actually
 * validated something, and ended the run "all checks passed". `gh` is absent from the remote
 * containers this repo is mostly developed in, so that was *every* local run; meanwhile a
 * malformed `needs-triage` issue was failing this same check on CI and reddening every open
 * pull request, and several sessions read a fully green `pnpm check` with no way to learn that
 * the one guard which would have caught it had never run (issue #1097). Same shape as a visual
 * run with no baseline resolved: nothing compared, not nothing wrong.
 */

/**
 * The exit code that means "this guard did not run", distinct from 0 (validated, clean) and 1
 * (validated, found problems). Deliberately not reachable from any validation path below: a
 * real failure that downgraded itself to a skip would be worse than the mislabelling this
 * replaces.
 */
export const SKIPPED_EXIT = 2;

export const LABEL = "needs-triage";
export const WAITING_LABEL = "waiting-on-external";
export const PARKED_LABEL = "parked";

const VALID_KINDS = new Set(["question", "improvement", "risk", "cleanup", "half-done"]);
const VALID_EFFORTS = new Set(["S", "M", "L"]);
/** Exported so `scripts/file-follow-up.mjs` composes a body in this order rather
 *  than keeping a second copy of the headings that would drift from these. */
export const REQUIRED_SECTIONS = [
  "What I noticed",
  "Why it isn't already done",
  "Proposed change",
  "Prompt",
];
// A section this short is a placeholder, not a finding. Chosen low on purpose:
// it catches "TBD" and a one-line shrug without demanding an essay.
const MIN_SECTION_WORDS = 15;
const MIN_PROMPT_WORDS = 40;
// Every top-level directory a follow-up legitimately names. `.github` and
// `public` were missing, and the gap was not theoretical: issue #1295 is a CI
// ticket whose prompt says "Read .github/workflows/ci.yml" in its first line,
// and this guard failed the whole repository's `check:repo` telling it to "say
// which files to read and change". A guard that refuses the one path a CI
// follow-up can possibly name is refusing the correct answer.
//
// Still a *directory* allowlist rather than "anything with a slash": the rule
// is that a cold reader gets an anchored place to start, and a bare
// `package.json` does not tell them which of the repo's concerns they are in.
const REPO_PATH = /(?:src|scripts|docs|e2e|infra|drizzle|public|\.github)\/[\w./[\]@-]+/;
const PLACEHOLDERS = ["short-slug", "YYYY-MM-DD", "TODO", "TBD", "src/lib/example.ts"];
// Either word order: "close this issue" and "this issue is closed" both count.
//
// Tested against the prompt with its whitespace collapsed to single spaces, because the two
// halves are routinely split by a line wrap — `[^.\n]` refuses to cross one, so a prompt
// ending "…is fine; close\nthis issue when the last one lands." failed the check while saying
// exactly what the check asks for (issue #632, 2026-08-21). Collapsing rather than allowing
// `\n` in the gap keeps the original intent: the two halves must be in one sentence, not
// merely within thirty characters of each other across a paragraph break.
const CLOSES_ITSELF =
  /clos(?:e|es|ed|ing)\b[^.\n]{0,30}\bthis issue\b|\bthis issue\b[^.\n]{0,30}\bclos(?:e|es|ed|ing)\b/i;

/** One line, for a test that must not be defeated by where a sentence happens to wrap. */
const unwrapped = (text) => text.replace(/\s+/g, " ");

const straight = (text) => text.replace(/[‘’]/g, "'");
/** The four required headings are plain words today; escape anyway, so adding one cannot break the anchor. */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (text) => text.split(/\s+/).filter(Boolean).length;

/** See scripts/check-live-trips.mjs's twin for the same trick — a backticked
 *  token is a path only when it carries a `/`; every guarded root is a
 *  directory, so a bare key (a message-bundle key, say) never does. */
function looksLikeAPath(token) {
  return token.includes("/");
}

/** `src/i18n/locales/en-US/diver.json:2673` names a line; drop it for the
 *  existence check rather than refusing the entry for including one. */
function withoutLineSuffix(token) {
  return token.replace(/:\d+(?::\d+)?$/, "");
}

/** A token carrying any of these is a pattern to expand, not a filename to look up. */
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Does this `**Touches:**` token name something in the tree?
 *
 * A plain token is the literal `access()` this has always done. A token with a
 * glob character in it is expanded instead, and one match is enough. Issue
 * #1339 is why: a change that edits the same namespace in every locale honestly
 * touches every `staff/trips.json` under `src/i18n/locales`, the entry said so
 * with a star for the locale segment, and the literal lookup failed — which
 * reddened `Repository safeguards` on PR #1335, a branch that had nothing to do
 * with it. Spelling out every locale instead is the same fact twice, and goes
 * stale the day a third one lands.
 *
 * The cost, accepted with eyes open: `src/**` satisfies this line forever. The
 * `Touches:` rule is about giving a cold reader an anchored place to start, and
 * a filer who wants to write something useless could always have named a
 * directory.
 */
export async function touchedPathExists(root, token) {
  if (!GLOB_CHARS.test(token)) {
    try {
      await access(path.join(root, token));
      return true;
    } catch {
      return false;
    }
  }
  for await (const match of glob(token, { cwd: root })) {
    if (match) return true;
  }
  return false;
}

/** The sentence for a `Touches:` token that resolved to nothing, saying which
 *  kind of nothing — a pattern that matched no files reads as a typo otherwise. */
export function missingTouchedProblem(token) {
  const detail = GLOB_CHARS.test(token) ? ` The pattern “${token}” matched no files.` : "";
  return `**Touches:** path “${token}” does not exist — name where the work lives today. A file only your own unmerged branch adds is not that: this resolves against the working tree, so it reddens every other session's \`pnpm check\` until you merge. List paths that exist on main and name the arriving ones in prose instead.${detail}`;
}

/** One `**Label:** …` line, including its wrapped continuation lines — the
 *  indented lines under it, up to the next bullet or blank line, joined with
 *  a space. GitHub issue bodies wrap the same way the old files did. */
function metadata(contents, label) {
  const match = contents.match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+(?:\\n[ \\t]+.+)*)$`, "m"));
  return match?.[1].replace(/\s*\n[ \t]+/g, " ").trim() ?? null;
}

/**
 * Body of one `## Heading` section, up to the next heading of any level.
 *
 * Anchored to the start of a line, which it was not until 2026-09-04: a plain
 * `indexOf("## " + heading)` matches the *prose* of an issue that quotes a
 * required heading name, and then reads the rest of that paragraph as the
 * section body. So an issue whose subject is this very format could not
 * describe the format without failing the check — issue #1356 was exactly that,
 * and its first attempted fix tripped the same bug a second time by containing
 * the string `"## Prompt"` in a code sample.
 *
 * The escaped `\\#` and the `m` flag are the whole fix: a heading is a `##` that
 * begins a line, and nothing else is.
 */
function section(contents, heading) {
  const normalized = straight(contents);
  const anchored = new RegExp(`^\\#\\# ${escapeRegExp(straight(heading))}\\s*$`, "m");
  const start = normalized.search(anchored);
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
 * @param issue `{ number, title, body }` from `gh issue list --json number,title,body,labels`
 * @param options `waiting: true` for an issue also carrying `waiting-on-external`, which
 *   demands a **Waiting on:** line instead of the ordinary flow; `parked: true` for one also
 *   carrying `parked`, which demands a **Parked:** line
 * @returns `problems` (human-readable; empty means valid) and the `touched` paths the
 *   caller checks against disk
 */
export function findIssueProblems(issue, { waiting = false, parked = false } = {}) {
  const problems = [];
  const say = (message) => problems.push(`#${issue.number} “${issue.title}”: ${message}`);
  const contents = straight(issue.body ?? "");

  if (words(issue.title) < 3) {
    say("the title should say what should happen, not just name an area");
  }

  if (waiting) {
    const waitingOn = metadata(contents, "Waiting on");
    if (!waitingOn) {
      say(
        `a ${WAITING_LABEL} issue needs a **Waiting on:** line naming the event that unblocks it and how to check whether it has happened`,
      );
    } else if (words(waitingOn) < 8) {
      say(
        "**Waiting on:** is too short to check cold — name the event *and* where a reader would look for it (a changelog, an issue, a dashboard)",
      );
    }
  }
  if (parked) {
    const parkedNote = metadata(contents, "Parked");
    if (!parkedNote)
      say(`a ${PARKED_LABEL} issue needs a **Parked:** line saying what would un-park it`);
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
      if (!CLOSES_ITSELF.test(unwrapped(prompt))) {
        say(
          'the prompt must tell the session to close this issue when the work lands (e.g. "close this issue")',
        );
      }
    }
  }

  for (const placeholder of PLACEHOLDERS) {
    if (contents.includes(placeholder)) say(`unfilled template text: “${placeholder}”`);
  }

  return { problems, touched };
}

/** `gh issue list --label <label> --state <state>`, bounded and JSON. Returns `null`
 *  (never throws) when `gh` cannot answer — unreachable, unauthenticated, not installed — so
 *  every caller can fail open rather than blocking on network state. `what` names the caller
 *  in the warning, since three different reports now share this reader.
 *
 *  `state` defaults to `open`, which is every caller inside `pnpm check`. The weekly persona
 *  walk (`scripts/persona-bots.mjs`) is the one that asks for `closed`: a finding whose issue
 *  a human has already ended is never filed again, and the closed list is the only way to
 *  know that. */
export function listIssuesByLabel(root, { label, fields, what, state = "open" }) {
  let raw;
  try {
    raw = readBounded(
      "gh",
      ["issue", "list", "--label", label, "--state", state, "--limit", "500", "--json", fields],
      { cwd: root, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.ghCliInCheckGate },
    );
  } catch (error) {
    console.warn(
      `${what}: could not reach \`gh issue list\` (${error.code === "ETIMEDOUT" ? "timed out" : "gh failed"}) — skipping. ${error.message ?? ""}`.trim(),
    );
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`${what}: \`gh issue list\` returned unparseable JSON — skipping.`);
    return null;
  }
}

/** The follow-up inbox: every open `needs-triage` issue, with the body the content check reads. */
export function listOpenFollowUps(root) {
  return listIssuesByLabel(root, {
    label: LABEL,
    fields: "number,title,body,labels,createdAt",
    what: "follow-ups",
  });
}

/**
 * **Pre-flight for one drafted body, before it becomes an issue.**
 *
 * A malformed `needs-triage` issue fails this guard, and this guard runs inside
 * every pull request's `pnpm check` — so one bad issue reddens *every open pull
 * request in the repository* until somebody edits it by hand. That is not a
 * hypothetical: it happened from one hand-written issue (#1097), and twice more
 * on 2026-09-08 in a single session (#1526 and #1555), each time taking out CI
 * runs on branches whose diffs could not possibly have caused it, and each time
 * discovered from a pull request several tickets downstream.
 *
 * The gap was never the rules or the docs. It was that an agent could not check
 * its own follow-up **before filing it**: the whole-tracker run needs `gh`, which
 * is absent from the cloud containers where most of these are written, so
 * `pnpm check:follow-ups` reported SKIPPED locally and CI was the first real
 * answer — after the damage. `findIssueProblems` was already exported and pure,
 * so the capability existed and only lacked a door. This is the door.
 *
 * Deliberately *not* a second implementation of anything: same
 * `findIssueProblems`, same rules, same messages.
 *
 * It resolves `**Touches:**` paths against **this** working tree, which is all
 * any run of this guard can do — but here that answer is advisory rather than
 * fatal, because a draft written on a branch may legitimately name a path that
 * branch adds. What no local check can tell you is whether the path will exist
 * in the tree of every *other* session running `pnpm check` before your branch
 * merges, which is the case that actually reddens their builds. Hence a warning
 * that says so rather than a pass or a failure.
 */
async function checkDraft(bodyPath, title) {
  let body;
  try {
    body = await readFile(path.resolve(process.cwd(), bodyPath), "utf8");
  } catch (error) {
    console.error(`follow-ups: could not read ${bodyPath} — ${error.message}`);
    process.exit(1);
  }
  // A title under three words is its own finding, so a caller who passes none
  // gets a placeholder long enough not to raise a second, unrelated complaint
  // about text they have not written yet.
  const { problems, touched } = findIssueProblems({
    number: 0,
    title: title ?? "draft follow-up title placeholder",
    body,
  });
  const missing = [];
  for (const item of touched) {
    if (await touchedPathExists(process.cwd(), item)) continue;
    missing.push(GLOB_CHARS.test(item) ? `${item} (matched no files)` : item);
  }
  if (problems.length > 0) {
    console.error(
      `Draft follow-up (${bodyPath}):\n${problems
        .map((item) => `- ${item.replace(/^#0 “[^”]*”: /, "")}`)
        .join("\n")}`,
    );
    console.error(
      "Fix these before filing: a malformed issue fails `check:follow-ups` inside every open pull request's `pnpm check`, not just your own. See docs/agents/issue-tracker.md's Filing a follow-up section.",
    );
    process.exit(1);
  }
  // Not a failure. The whole-tracker run resolves these against the working
  // tree, and a draft filed from a branch may legitimately name a path that
  // branch adds — but it will redden every *other* session's check until the
  // branch merges, so it is worth knowing now rather than from CI.
  if (missing.length > 0) {
    console.warn(
      `follow-ups: ${bodyPath} names ${missing.length} path(s) not on disk here — ${missing.join(", ")}. If your branch adds them, name them in prose instead; **Touches:** is resolved against the working tree of every session that runs \`pnpm check\`.`,
    );
  }
  console.log(`follow-ups: ${bodyPath} is a valid follow-up body`);
}

/**
 * `--body <path>` and an optional `--title <text>`, and **nothing else**.
 *
 * Strict on purpose, which for a ten-line argument parser needs saying. This
 * tool exists to catch a mistake before it costs every open pull request an
 * hour, so a mistyped invocation that quietly succeeds is the one outcome worth
 * engineering against: `--body draft.md --boddy other.md` must not validate
 * `draft.md` and exit 0, leaving the agent believing it checked something it
 * did not. Anything unrecognised, repeated, or positional is an error.
 *
 * `present` is separate from `value` for the same reason, so `--body --title x`
 * reports a missing path rather than trying to read a file called `--title`.
 *
 * Returns `{ error }` instead of exiting, so the tests can read the message.
 */
export function parseDraftArgs(argv) {
  const flags = { "--body": undefined, "--title": undefined };
  const seen = new Set();
  for (let at = 0; at < argv.length; at += 1) {
    const name = argv[at];
    if (!(name in flags)) {
      return {
        error: `follow-ups: unrecognised argument \`${name}\` — only --body <path> and --title <text>`,
      };
    }
    if (seen.has(name)) return { error: `follow-ups: ${name} given twice` };
    seen.add(name);
    const value = argv[at + 1];
    if (value === undefined || value in flags) {
      return {
        error:
          name === "--body"
            ? "follow-ups: --body needs a path to the drafted issue body"
            : "follow-ups: --title needs the title you intend to file",
      };
    }
    flags[name] = value;
    at += 1;
  }
  return { body: flags["--body"], title: flags["--title"] };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const { error, body, title } = parseDraftArgs(args);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    if (body === undefined) {
      console.error("follow-ups: --title is only meaningful beside a --body <path>");
      process.exit(1);
    }
    await checkDraft(body, title);
    return;
  }

  const root = process.cwd();
  const issues = listOpenFollowUps(root);
  // Fail open, but say so — see the module doc comment. The warning naming the reason has
  // already been printed by `listIssuesByLabel`.
  if (issues === null) {
    process.exit(SKIPPED_EXIT);
  }

  const problems = [];
  for (const issue of issues) {
    const labelNames = new Set((issue.labels ?? []).map((label) => label.name));
    const result = findIssueProblems(issue, {
      waiting: labelNames.has(WAITING_LABEL),
      parked: labelNames.has(PARKED_LABEL),
    });
    problems.push(...result.problems);
    for (const touched of result.touched) {
      if (await touchedPathExists(root, touched)) continue;
      problems.push(`#${issue.number} “${issue.title}”: ${missingTouchedProblem(touched)}`);
    }
  }

  if (problems.length > 0) {
    console.error(
      `Follow-up issues (label:${LABEL}):\n${problems.map((item) => `- ${item}`).join("\n")}`,
    );
    console.error(
      "Each entry is a task a human runs cold, months later — see docs/agents/issue-tracker.md's Filing a follow-up section.",
    );
    // The one thing the list above does not say, and the reason this guard is
    // confusing to meet: these are problems in the *tracker*, not in the branch
    // that happens to be running. This check reads the live issue list, so a
    // malformed issue fails it on every open pull request at once, and nothing
    // in your diff caused it or can fix it.
    console.error(
      "These are tracker problems, not branch problems: edit the issues named above. Nothing in this branch caused them, and every other open pull request is failing the same way until they are fixed. File through `node scripts/file-follow-up.mjs` — it composes the body and refuses to call `gh` when it would not pass — or draft a body to a file and run `node scripts/check-follow-ups.mjs --body <path>` before filing, to avoid adding to this.",
    );
    process.exit(1);
  }

  const waitingCount = issues.filter((issue) =>
    (issue.labels ?? []).some((label) => label.name === WAITING_LABEL),
  ).length;
  console.log(
    `follow-ups: ${issues.length} open under label:${LABEL} (${waitingCount} waiting on somebody else)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

// Exported so a caller (gate-freshness.mjs) can read the raw contents helper without
// re-implementing the metadata/section grammar.
export { metadata as followUpMetadata, section as followUpSection, straight as followUpStraight };
