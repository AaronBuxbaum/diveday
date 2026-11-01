#!/usr/bin/env node
// A pull request that touches a safety-critical or security-sensitive path names, in its
// body's "Reviews launched" section, the reviewer agent that path needs.
//
// AGENTS.md says the reviewer agents are "launched, never skipped": `dive-domain-expert` for
// manifests, roll call, readiness, cert gating, medical flags and erasure; `security-reviewer`
// for auth, tokens, personal or medical data, and export/import. Nothing checked it. Between
// 2026-10-07 and 2026-10-10, 17 of 85 merged pull requests mentioned a reviewer anywhere, while
// `src/lib/manifests.ts`, `src/db/seat-diver.ts` and the course-form seal all changed. A launch
// that is not written down cannot be told from one that never happened, so the body is where
// it is recorded (`.github/pull_request_template.md`), and this reads it.
//
// It checks that the reviewer is *named* with an answer — "launched" and what it found, or "not
// needed because …" with a reason — never the quality of the review. A reason is a human's to
// judge; "yes" or "n/a" is not one.
//
// It also requires a `Closes #n` for every open issue whose `## Claim` comment names the pull
// request's head branch (`--head`, else `GITHUB_HEAD_REF`, else the current branch). #2241's claim
// said "closes with #2326" in prose; #2326 merged and the issue stayed open and in-progress. The
// tracker is read through scripts/tracker.mjs; when GitHub cannot answer, that half is skipped
// with a warning, never failed.
//
// CI runs it in the safeguards job on every pull request event, with the body read live (so an
// edit counts on the next run) or from the event payload, and the diff against the base:
//
//   node scripts/check-pr-body.mjs --body-file <path> --base <sha> [--head <branch>]
//   node scripts/check-pr-body.mjs --body-file <path> --files <list-file>   (local, a file per line)
//
// With no `--base` and no `--files` it diffs against `origin/main`, which is what a session
// drafting a body wants.

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { IN_PROGRESS_LABEL, latestClaimIn } from "./claims.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { tracker } from "./tracker.mjs";

/** Never a surface: the PWA web manifest, and copy bundles every pull request edits. */
const NOT_SURFACES = [/^src\/app\/manifest\.ts$/, /^src\/i18n\/locales\//];

/** `src/db/waivers.ts`, `src/lib/waiver-tokens.ts`, … : signed consent and its medical answers. */
const WAIVER_MODULES = /^src\/(db|lib)\/waivers?[^/]*\.ts$/;

/** About a waiver without being one: test files and fixtures, message bundles, copy resolvers. */
const NOT_WAIVER_LOGIC = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /test-fixtures/,
  /^src\/test\//,
  /^src\/app\/api\/test\//,
  /^src\/i18n\//,
  /^src\/(app|components)\/.*-copy\.ts$/,
];

/**
 * Every other `src/**` path naming a waiver: the shop's waiver actions, the roster and party
 * queues, the paper and counter forms, the diver's signing route. Until 2026-11-01 only the
 * db/lib modules above matched, so a change to any of these passed with no reviewer named. A
 * UI-only change answers "not needed because <reason>".
 */
const WAIVER_SURFACES = {
  test: (file) => file.includes("waiver") && !NOT_WAIVER_LOGIC.some((re) => re.test(file)),
};

/** The doctor-referral form: a diver's medical answers, sent to and back from a physician. */
const DOCTOR_FORM = /^src\/app\/waivers\/\[token\]\/doctor\//;

/** The two framings of a safety review, each named on its own "Reviews launched" line. */
export const SAFETY_FRAMINGS = ["dock operator", "attacker"];

/**
 * The paths each reviewer owns, from AGENTS.md's hard rules and the reviewer agents' own
 * descriptions. Only `src/**`: a document about a manifest is not a manifest. Matched against the
 * lowercased path; a pattern is anything with a `test(path)` method.
 */
export const REVIEWS = [
  {
    agent: "dive-domain-expert",
    // Two independent runs, one per framing (docs/agents/working-rules.md, "Safety-critical
    // surfaces"). Until 2026-11-01 one answered line passed, so one run read as two.
    framings: SAFETY_FRAMINGS,
    surface:
      "safety-critical (manifests, roll call, readiness, cert gating, medical, waivers, erasure, the booking transaction)",
    patterns: [
      /manifest/,
      /roll-?call/,
      /readiness/,
      /trip-admission/,
      /certification/,
      /cert-?check/,
      /mark-?certified/,
      /medical/,
      /erase|erasure|anonymi[sz]/,
      /seat-diver/,
      /nitrox/,
      WAIVER_SURFACES,
      DOCTOR_FORM,
      /^src\/db\/bookings\.ts$/,
    ],
  },
  {
    agent: "security-reviewer",
    surface:
      "security-sensitive (auth, tokens, personal or medical data, waivers, payments, webhooks, export/import)",
    patterns: [
      /^src\/proxy\.ts$/,
      /^src\/lib\/(auth|authz|auth-secret|session)\.ts$/,
      /account-tokens|user-accounts/,
      /\[token\]\/(actions|route|page|layout)\.tsx?$/,
      /^src\/app\/(invite|claim)\//,
      /^src\/(db|lib)\/(export|import)[^/]*\.ts$/,
      /^src\/features\/backup-export\//,
      /^src\/app\/api\/cron\/(backup-export|platform-backup)\//,
      /^src\/db\/schema\/(accounts|core|waivers|certifications|erasure)\.ts$/,
      /medical/,
      /erase|erasure|anonymi[sz]/,
      WAIVER_MODULES,
      /^src\/lib\/payments\//,
      /^src\/app\/api\/webhooks\//,
    ],
  },
];

/** For each reviewer, the changed paths that need it. Reviewers with none are left out. */
export function reviewsNeeded(files) {
  const needed = [];
  for (const review of REVIEWS) {
    const hits = files.filter((file) => {
      if (!file.startsWith("src/") || NOT_SURFACES.some((re) => re.test(file))) return false;
      const lower = file.toLowerCase();
      return review.patterns.some((re) => re.test(lower));
    });
    if (hits.length > 0) needed.push({ ...review, files: hits });
  }
  return needed;
}

/** The body's "Reviews launched" section, HTML comments removed; null when there is none. */
export function reviewsSection(body) {
  let text = String(body ?? "").replace(/\r\n/g, "\n");
  // Strip until no comment is left: a comment whose removal exposes another is not a comment.
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  }
  const match = text.match(/^##\s+Reviews[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  return match ? match[1] : null;
}

/**
 * Whether `section` names `agent` with an answer: the rest of the line after the name says it was
 * "launched" or what it "found", or that it was "not needed because" something. "yes", "n/a" and
 * the template's placeholder all passed before 2026-10-12, which made the line a checkbox.
 */
export function reviewAnswered(section, agent) {
  return reviewAnswers(section, agent).length > 0;
}

/** Each line of `section` that names `agent` with an answer, and which kind of answer it is. */
function reviewAnswers(section, agent) {
  const answers = [];
  for (const line of String(section ?? "").split("\n")) {
    const at = line.indexOf(agent);
    if (at === -1) continue;
    const answer = line
      .slice(at + agent.length)
      .replace(/<[^>]*>/g, " ")
      .replace(/[`*_:|—–-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/(?<!\b(?:not|never|un) ?)\b(launched|found)\b/i.test(answer)) {
      answers.push({ line: line.toLowerCase(), ran: true });
    } else if (/\bnot needed because\b\s*\S{2,}/i.test(answer)) {
      answers.push({ line: line.toLowerCase(), ran: false });
    }
  }
  return answers;
}

/**
 * Whether `section` records one run of `agent` per framing, each on its own answered line that
 * names the framing ("launched" or "found"), or says the review was "not needed because" something.
 * One line naming two framings counts for one of them, never both: two runs are two lines.
 */
export function framedReviewsAnswered(section, agent, framings) {
  const answers = reviewAnswers(section, agent);
  if (answers.some((answer) => !answer.ran)) return true;
  const runs = answers.map((answer) => answer.line);
  const assign = (index, used) =>
    index === framings.length ||
    runs.some(
      (line, at) =>
        !used.has(at) &&
        line.includes(framings[index]) &&
        assign(index + 1, new Set([...used, at])),
    );
  return assign(0, new Set());
}

/**
 * The open issues whose newest `## Claim` names `head` as its branch or as one of its aliases
 * (`(assembled into X)`, `(sub-branch Y)`), from issues labelled in-progress (a claim always
 * carries the label; one whose label expired is not a live claim).
 */
export function issuesClaimedBy(issues, head) {
  if (!head) return [];
  return (issues ?? [])
    .filter((issue) => latestClaimIn(issue.comments)?.branches?.includes(head))
    .map((issue) => issue.number);
}

/** The issue numbers `body` closes with a GitHub closing keyword. */
export function closedByBody(body) {
  const keyword = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi;
  return new Set([...String(body ?? "").matchAll(keyword)].map((match) => Number(match[1])));
}

/** A sentence for each claimed issue the body does not close. */
export function closesProblems({ body, claimed, head }) {
  const closed = closedByBody(body);
  return claimed
    .filter((number) => !closed.has(number))
    .map(
      (number) =>
        `Issue #${number} is claimed by this branch (\`${head}\`) and the body does not close it. Add "Closes #${number}" on its own line under "## Follow-ups filed", or, if this pull request does not finish it, post a fresh claim naming the branch that will.`,
    );
}

/** Every problem with this body for this diff, as sentences. Empty means it passes. */
export function bodyProblems({ body, files }) {
  const needed = reviewsNeeded(files);
  if (needed.length === 0) return [];
  const section = reviewsSection(body);
  const problems = [];
  for (const review of needed) {
    const answered = review.framings
      ? framedReviewsAnswered(section, review.agent, review.framings)
      : reviewAnswered(section, review.agent);
    if (section !== null && answered) continue;
    const shown = review.files.slice(0, 5).join(", ");
    const more = review.files.length > 5 ? ` and ${review.files.length - 5} more` : "";
    const touches = `This pull request touches ${review.surface} paths (${shown}${more})`;
    const skip = `"\`${review.agent}\`: not needed because <reason>"`;
    problems.push(
      review.framings
        ? `${touches}, and its "## Reviews launched" section does not record ${review.framings.length} answered \`${review.agent}\` runs, one line each framed as ${review.framings.map((f) => `"${f}"`).join(" and ")}. Launch them in parallel on the diff and write one line per run, ${review.framings.map((f) => `"- \`${review.agent}\` (${f}): launched; found …"`).join(" and ")}, or write ${skip}.`
        : `${touches}, and its "## Reviews launched" section does not name \`${review.agent}\` with an answer. Launch it on the diff and write what it found, or write ${skip}.`,
    );
  }
  return problems;
}

function changedFiles({ base, filesFile }) {
  if (filesFile) {
    return readFileSync(filesFile, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const output = readBounded("git", ["diff", "--name-only", `${base ?? "origin/main"}...HEAD`], {
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  return String(output).split("\n").filter(Boolean);
}

function currentBranch() {
  try {
    return String(
      readBounded("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
      }),
    ).trim();
  } catch {
    return "";
  }
}

/** Issues claimed by `head`, or null (with a warning) when GitHub cannot answer. */
function claimedIssues(head) {
  try {
    const issues = tracker().listIssues({ label: IN_PROGRESS_LABEL, comments: true });
    return issuesClaimedBy(issues, head);
  } catch (error) {
    console.warn(
      `pr-body: could not read claims from GitHub, Closes check skipped — ${error.message}`,
    );
    return null;
  }
}

function argValue(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bodyFile = argValue(args, "--body-file");
  if (!bodyFile) {
    console.error(
      "Usage: node scripts/check-pr-body.mjs --body-file <path> [--base <sha> | --files <path>] [--head <branch>]",
    );
    process.exit(2);
  }
  const body = readFileSync(bodyFile, "utf8");
  const files = changedFiles({
    base: argValue(args, "--base"),
    filesFile: argValue(args, "--files"),
  });
  const head = argValue(args, "--head") || process.env.GITHUB_HEAD_REF || currentBranch();
  const claimed = head && head !== "HEAD" ? claimedIssues(head) : [];
  const problems = [
    ...bodyProblems({ body, files }),
    ...closesProblems({ body, claimed: claimed ?? [], head }),
  ];
  if (problems.length > 0) {
    console.error(`Pull request body:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    console.error(
      "The section is in .github/pull_request_template.md; why: docs/agents/repo-checks.md#pr-body.",
    );
    process.exit(1);
  }
  const needed = reviewsNeeded(files).map((review) => review.agent);
  console.log(
    needed.length > 0
      ? `pr-body: ${needed.join(" and ")} named for ${files.length} changed files`
      : `pr-body: none of ${files.length} changed files needs a reviewer agent`,
  );
  if (claimed) {
    console.log(
      `pr-body: ${claimed.length} issue(s) claimed by \`${head}\`, each closed by the body`,
    );
  }
}
