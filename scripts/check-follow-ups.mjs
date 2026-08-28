import { access } from "node:fs/promises";
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

/** One `**Label:** …` line, including its wrapped continuation lines — the
 *  indented lines under it, up to the next bullet or blank line, joined with
 *  a space. GitHub issue bodies wrap the same way the old files did. */
function metadata(contents, label) {
  const match = contents.match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+(?:\\n[ \\t]+.+)*)$`, "m"));
  return match?.[1].replace(/\s*\n[ \t]+/g, " ").trim() ?? null;
}

/** Body of one `## Heading` section, up to the next heading of any level. */
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

/** `gh issue list --label <label> --state open`, bounded and JSON. Returns `null`
 *  (never throws) when `gh` cannot answer — unreachable, unauthenticated, not installed — so
 *  every caller can fail open rather than blocking on network state. `what` names the caller
 *  in the warning, since two different reports now share this reader. */
export function listIssuesByLabel(root, { label, fields, what }) {
  let raw;
  try {
    raw = readBounded(
      "gh",
      ["issue", "list", "--label", label, "--state", "open", "--limit", "500", "--json", fields],
      { cwd: root, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.ghCli },
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

async function main() {
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
      try {
        await access(path.join(root, touched));
      } catch {
        problems.push(
          `#${issue.number} “${issue.title}”: **Touches:** path “${touched}” does not exist — name where the work lives today. A file only your own unmerged branch adds is not that: this resolves against the working tree, so it reddens every other session's \`pnpm check\` until you merge. List paths that exist on main and name the arriving ones in prose instead.`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(
      `Follow-up issues (label:${LABEL}):\n${problems.map((item) => `- ${item}`).join("\n")}`,
    );
    console.error(
      "Each entry is a task a human runs cold, months later — see docs/agents/issue-tracker.md's Filing a follow-up section.",
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
