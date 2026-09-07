#!/usr/bin/env node

import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { listIssuesByLabel } from "./check-follow-ups.mjs";
import {
  FILING_LIMITS,
  fingerprintFromBody,
  PERSONA_LABEL,
  planFilings,
  RECONFIRM_MARKER,
  renderIssueBody,
  renderIssueTitle,
  renderRecurrenceComment,
  renderSummary,
} from "./persona-bots/lib.mjs";
import { LENSES, PERSONAS, stopCount } from "./persona-bots/personas.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * `pnpm personas:file` — decide what the tracker hears about a walk, and say so
 * either way (N-61).
 *
 * The walk (`pnpm personas`) writes `personas/findings.json` and touches
 * nothing else. This is the step that reads it, asks GitHub which persona
 * issues are already open, and applies the volume policy in
 * `scripts/persona-bots/lib.mjs`: a fingerprint already open is never filed
 * twice, a run may open very few and never more than one per persona, and a
 * full inbox stops the filing entirely. Then it writes `personas/summary.md`
 * naming everything it saw — including what it held back and why, because a
 * capped run that printed only its three issues would read as a clean week.
 *
 * **It defaults to reading only.** Nothing is written to the tracker without
 * `--file`, which the weekly workflow passes and a laptop does not, so a
 * developer reproducing a finding cannot accidentally open issues.
 *
 * **A run that cannot read the open issues does not file.** Deduplication is
 * the whole safety mechanism, and filing blind would put a copy of every
 * standing finding into the inbox on the first bad network day. Same discipline
 * as `check:follow-ups`: fail open, and say plainly that the guard did not run.
 *
 * Options: `--file` (actually write), `--in <dir>` (default `personas`),
 * `--run-url <url>` (the workflow run the screenshots live in).
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const ROOT = process.cwd();
const inDir = path.resolve(ROOT, option("--in") ?? process.env.PERSONA_BOTS_OUT ?? "personas");
const write = flag("--file");
const runUrl =
  option("--run-url") ||
  (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "");
/** The artifact the screenshots are uploaded under; the issue body links a reader to it. */
const ARTIFACT_NAME = "personas";

let walk;
try {
  walk = JSON.parse(readFileSync(path.join(inDir, "findings.json"), "utf8"));
} catch (error) {
  console.error(
    `persona-bots: no findings to read at ${path.join(inDir, "findings.json")} — run \`pnpm personas\` first. ${error.message}`,
  );
  process.exit(1);
}

const runAt = walk.finishedAt ?? new Date().toISOString();

// **Before the listing, not after it.** On the very first run the label does
// not exist yet, and `gh issue list --label` against a label the repository has
// never had can answer with an error rather than an empty list. That error is
// indistinguishable from an unreachable GitHub, so the fail-closed branch below
// would take it — and the bot would file nothing, quietly, forever, on a
// repository where nothing was wrong. Creating it first costs one idempotent
// call and removes the question. Read-only runs skip it: they file nothing
// anyway, so a missing label there means "no persona issues", correctly.
if (write) ensureLabel();

const issues = listIssuesByLabel(ROOT, {
  label: PERSONA_LABEL,
  fields: "number,title,body,createdAt,comments",
  what: "persona-bots",
});

if (issues === null) {
  // Read the module docblock before "fixing" this: filing without knowing what
  // is already open is the one failure mode the whole design is against.
  console.warn(
    "persona-bots: could not ask GitHub which persona issues are open, so nothing was filed. The walk's findings are still in personas/findings.json.",
  );
  writeSummary(
    `# Persona walk\n\nThe walk ran and found ${walk.findings.length} things, and none of them were filed: \`gh\` could not say which persona issues are already open, and filing without that would put a copy of every standing finding into the inbox. Nothing here is a verdict on the week.\n`,
  );
  process.exit(0);
}

const openIssues = issues
  .map((issue) => ({
    number: issue.number,
    title: issue.title,
    fingerprint: fingerprintFromBody(issue.body),
    lastReportedAt: lastWordFrom(issue),
  }))
  .filter((issue) => issue.fingerprint);

const plan = planFilings({
  findings: walk.findings ?? [],
  openIssues,
  lenses: LENSES,
  now: new Date(runAt),
  limits: FILING_LIMITS,
});

const failures = [];
if (write) {
  for (const entry of plan.file) {
    const number = createIssue(entry.finding);
    if (number) entry.issueNumber = number;
    else failures.push(`could not file "${renderIssueTitle(entry.finding)}"`);
  }
  for (const entry of plan.comment) {
    if (
      !commentOn(
        entry.issue.number,
        renderRecurrenceComment(entry.finding, { runUrl, runAt, caps: plan.caps }),
      )
    ) {
      failures.push(`could not comment on #${entry.issue.number}`);
    }
  }
} else {
  console.log("persona-bots: reading only — pass --file to write to the tracker.");
}

const summary = renderSummary(plan, {
  lenses: LENSES,
  runAt,
  runUrl,
  stops: walk.stops ?? stopCount(),
  personas: walk.personas ?? PERSONAS.length,
});
writeSummary(summary);
console.log(summary);

if (failures.length > 0) {
  console.error(`persona-bots:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

/**
 * When this run last said anything about an issue: the newest re-confirmation
 * it left, or the day it filed the issue. Deliberately not the issue's
 * `updatedAt` — a human's comment or a label change would look like the bot
 * having spoken, and the window exists to bound *the bot's* noise.
 */
function lastWordFrom(issue) {
  const mine = (issue.comments ?? [])
    .filter((comment) => String(comment.body ?? "").includes(RECONFIRM_MARKER))
    .map((comment) => comment.createdAt)
    .filter(Boolean)
    .sort();
  return mine.length > 0 ? mine[mine.length - 1] : issue.createdAt;
}

function ensureLabel() {
  gh(
    [
      "label",
      "create",
      PERSONA_LABEL,
      "--force",
      "--color",
      "0e8a16",
      "--description",
      "Found by the weekly persona walk (N-61)",
    ],
    { quiet: true },
  );
}

function createIssue(finding) {
  const body = renderIssueBody(finding, {
    lenses: LENSES,
    runAt,
    runUrl,
    artifactName: ARTIFACT_NAME,
  });
  const file = bodyFile(body);
  const output = gh([
    "issue",
    "create",
    "--title",
    renderIssueTitle(finding),
    "--label",
    `needs-triage,${PERSONA_LABEL}`,
    "--body-file",
    file,
  ]);
  return output ? Number(output.trim().match(/\/(\d+)\s*$/)?.[1]) || null : null;
}

function commentOn(number, body) {
  return gh(["issue", "comment", String(number), "--body-file", bodyFile(body)]) !== null;
}

/**
 * A body goes to `gh` through a file, never an argument. Issue bodies here run
 * to thousands of characters and carry newlines, backticks and quoted console
 * output; an argv is the wrong shape for that on every platform.
 */
function bodyFile(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "persona-bots-"));
  const file = path.join(dir, "body.md");
  writeFileSync(file, body);
  return file;
}

function gh(ghArgs, { quiet = false } = {}) {
  try {
    return readBounded("gh", ghArgs, {
      cwd: ROOT,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
    });
  } catch (error) {
    if (!quiet)
      console.error(`persona-bots: \`gh ${ghArgs[0]} ${ghArgs[1]}\` failed: ${error.message}`);
    return null;
  }
}

function writeSummary(text) {
  writeFileSync(path.join(inDir, "summary.md"), text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  }
}
