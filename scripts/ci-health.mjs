#!/usr/bin/env node
// How often CI said no last week, and whether a red run was listened to.
//
// The 2026-10-22 review found landing passing code had got slow, and only by reading two weeks of
// runs by hand: red CI runs per pull request rose from 0.4 (10-13 to 10-15) to 1.4 (10-19 to
// 10-22), and of the 18 pushes that followed a red run and came back red, 14 were red again on a
// test the run before had already named. Nothing measured either number, so nobody saw the
// trend for a week. `.github/workflows/ci-health.yml` runs this every Monday:
//
//   node scripts/ci-health.mjs [--days 7] [--summary <file>] [--file-issue] [--dry-run]
//
// For every pull request merged or updated in the window, it reads the pull request's CI runs
// (`ci.yml`, `pull_request` event, finished green or red; a cancelled run is no verdict), and for
// each red run its jobs and their annotations, and computes:
//
//   - red runs per pull request, and the share green on their first run;
//   - the repeat-red rate: of the pushes that followed a red run on the same pull request, how
//     many were red again on a test the previous run had named (the unit files
//     `src/test/failed-files-reporter.ts` annotates and the tests the "Playwright Run Summary"
//     notice lists, read by `scripts/own-ci.mjs`'s `ownVerdict`);
//   - the median and p90 CI run, in minutes;
//   - the failing jobs, ranked (shard numbers folded together; the aggregate "CI result" left out).
//
// With `--file-issue`, a week over a threshold opens one `needs-triage` issue, or comments the
// week's table on the one already open (found by its label and exact title). The body is a
// follow-up in the shape `scripts/check-follow-ups.mjs` requires, and refused here if it is not.
// Every `gh api` call is bounded, and names `repos/AaronBuxbaum/diveday/...` only: no search API.

import { appendFileSync } from "node:fs";
import process from "node:process";

import { findIssueProblems, LABEL as TRIAGE_LABEL } from "./check-follow-ups.mjs";
import { renderFollowUpBody } from "./file-follow-up.mjs";
import { ownVerdict } from "./own-ci.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { tracker as defaultTracker, GH_MAX_BUFFER } from "./tracker.mjs";

export const REPO = "AaronBuxbaum/diveday";

/**
 * Over this many red CI runs per pull request, the week files an issue. 2026-10-22 review: 0.4 in
 * a good week (10-13 to 10-15, the full local gate), 1.4 in a bad one (10-19 to 10-22).
 */
export const RED_RUNS_PER_PR_MAX = 1.0;

/**
 * Over this repeat-red rate, the week files an issue. 2026-10-22 review: 37 pushes followed a red
 * run, 18 came back red, and 14 of those 18 were red again on a test the previous run had named
 * (14/37, 38%, by this script's measure). A push meant to fix a named test should rarely fail it
 * again now that `verify:push` replays it.
 */
export const REPEAT_RED_MAX = 0.25;

export const ISSUE_TITLE = "Bring CI back under its weekly health thresholds";

const RED = new Set(["failure", "timed_out"]);
const VERDICT = new Set(["success", "failure", "timed_out"]);

const isRed = (run) => RED.has(run.conclusion);

/** A job's name with its shard number folded, so six Playwright shards rank as one row. */
export function jobKind(name) {
  return name.replace(/\bshard \d+\/\d+/, "shard *").replace(/\bshard \d+\b/, "shard *");
}

/** The `p`th percentile (0..1) of `values`, nearest rank; null for none. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
}

/** Minutes from a run's start to its last update, or null when either is missing. */
export function runMinutes(run) {
  const start = Date.parse(run.run_started_at ?? run.created_at ?? "");
  const end = Date.parse(run.updated_at ?? "");
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 60_000;
}

/**
 * The tests a red run named, as keys comparable across runs: `unit:<file>`, `spec:<file>` and
 * `capture:<title>`, from `ownVerdict` over the run's jobs and their annotations.
 */
export function namedTests(jobs, annotationsOf) {
  const verdict = ownVerdict(jobs, annotationsOf);
  return new Set([
    ...verdict.files.map((file) => `unit:${file}`),
    ...verdict.specs.map((spec) => `spec:${spec}`),
    ...verdict.captures.map((title) => `capture:${title}`),
  ]);
}

/**
 * The week's numbers. `prs` is `[{ number, runs }]`; each run is a workflow run
 * (`{ id, head_sha, conclusion, created_at, run_started_at, updated_at }`), and a red one also
 * carries `jobs` (its jobs) and `named` (a Set from {@link namedTests}).
 */
export function computeHealth(prs) {
  let runs = 0;
  let red = 0;
  let withCi = 0;
  let firstGreen = 0;
  let followedRed = 0;
  let redAgain = 0;
  let repeated = 0;
  const minutes = [];
  const failing = new Map();
  const repeats = [];

  for (const pr of prs) {
    const done = (pr.runs ?? [])
      .filter((run) => VERDICT.has(run.conclusion))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (done.length === 0) continue;
    withCi += 1;
    if (!isRed(done[0])) firstGreen += 1;
    for (const run of done) {
      runs += 1;
      const took = runMinutes(run);
      if (took !== null) minutes.push(took);
      if (!isRed(run)) continue;
      red += 1;
      for (const job of run.jobs ?? []) {
        if (!RED.has(job.conclusion) || job.name === "CI result") continue;
        const kind = jobKind(job.name);
        failing.set(kind, (failing.get(kind) ?? 0) + 1);
      }
    }
    for (let i = 1; i < done.length; i += 1) {
      const before = done[i - 1];
      const after = done[i];
      // A re-run of the same commit is not a push, so it is not a fix that was tried.
      if (!isRed(before) || after.head_sha === before.head_sha) continue;
      followedRed += 1;
      if (!isRed(after)) continue;
      redAgain += 1;
      const again = [...(after.named ?? [])].filter((key) => before.named?.has(key));
      if (again.length > 0) {
        repeated += 1;
        repeats.push({ pr: pr.number, run: after.id, tests: again.sort() });
      }
    }
  }

  return {
    prs: withCi,
    runs,
    red,
    runsPerPr: withCi ? runs / withCi : 0,
    redPerPr: withCi ? red / withCi : 0,
    firstGreen: withCi ? firstGreen / withCi : 0,
    followedRed,
    redAgain,
    repeated,
    repeatRate: followedRed ? repeated / followedRed : 0,
    medianMinutes: percentile(minutes, 0.5),
    p90Minutes: percentile(minutes, 0.9),
    failing: [...failing].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    repeats,
  };
}

/** Which thresholds the week crossed, as sentences; empty for a healthy week. */
export function breaches(health) {
  const out = [];
  if (health.redPerPr > RED_RUNS_PER_PR_MAX)
    out.push(
      `red CI runs per pull request were ${health.redPerPr.toFixed(1)}, over ${RED_RUNS_PER_PR_MAX.toFixed(1)}`,
    );
  if (health.repeatRate > REPEAT_RED_MAX)
    out.push(`the repeat-red rate was ${pct(health.repeatRate)}, over ${pct(REPEAT_RED_MAX)}`);
  return out;
}

const pct = (share) => `${Math.round(share * 100)}%`;
const mins = (value) => (value === null ? "n/a" : `${Math.round(value)} min`);

/** The week as Markdown: the measures, then the failing jobs ranked. */
export function renderTable(health, { since, until } = {}) {
  const lines = [];
  if (since) lines.push(`Pull requests merged or updated ${since} to ${until}.`, "");
  lines.push(
    "| Measure | This week | Threshold |",
    "| --- | --- | --- |",
    `| Pull requests with CI | ${health.prs} | |`,
    `| CI runs per pull request | ${health.runsPerPr.toFixed(1)} | |`,
    `| Red CI runs per pull request | ${health.redPerPr.toFixed(1)} | ${RED_RUNS_PER_PR_MAX.toFixed(1)} |`,
    `| Green on first run | ${pct(health.firstGreen)} | |`,
    `| Pushes after a red run | ${health.followedRed} | |`,
    `| ... red again | ${health.redAgain} | |`,
    `| ... red again on a test the previous run named (repeat red) | ${health.repeated} (${pct(health.repeatRate)}) | ${pct(REPEAT_RED_MAX)} |`,
    `| Median CI run | ${mins(health.medianMinutes)} | |`,
    `| p90 CI run | ${mins(health.p90Minutes)} | |`,
  );
  if (health.failing.length > 0) {
    lines.push("", "| Failing job | Red runs |", "| --- | --- |");
    for (const [name, count] of health.failing) lines.push(`| ${name} | ${count} |`);
  }
  if (health.repeats.length > 0) {
    lines.push("", "Repeat reds:");
    for (const { pr, run, tests } of health.repeats.slice(0, 20))
      lines.push(`- #${pr}, run ${run}: ${tests.slice(0, 3).join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The issue body for a week over a threshold; the week's table goes in "What I noticed". */
export function issueBody(health, { since, until, runUrl }) {
  return renderFollowUpBody({
    kind: "risk",
    effort: "M",
    touches: [
      "scripts/ci-health.mjs",
      ".github/workflows/ci.yml",
      "scripts/verify-push.mjs",
      "docs/agents/verifying.md",
    ],
    noticed: [
      `The weekly CI health check found ${breaches(health).join(", and ")}.`,
      "",
      renderTable(health, { since, until }).trim(),
      "",
      runUrl ? `Run: ${runUrl}` : "",
    ]
      .join("\n")
      .trim(),
    why: "Nobody reads two weeks of CI runs by hand until landing code has already got slow; this check exists so the trend is seen in its first week. Which cause dominates (fix pushes not checked against the failures they fix, big pushes, slower shards, a red base) changes week to week, and only the runs say which.",
    proposed:
      "Read the failing jobs and the repeat reds in the table. A high repeat-red rate means fix pushes are going out without replaying what CI named, so check `verify:push`'s own-CI step and the Fast lane job. High red runs per pull request with few repeats means new breaks: look at push size and at which job ranks first. Fix the cause, not the threshold.",
    prompt:
      "The weekly CI health check (`.github/workflows/ci-health.yml`, running `scripts/ci-health.mjs`) found red CI runs per pull request or the repeat-red rate over its threshold; this issue's body and comments hold each week's table. Read `docs/agents/verifying.md` (the pre-push gate and the Fast lane), `scripts/own-ci.mjs` and `scripts/fast-lane.mjs`, then the runs behind the top failing job with `gh api repos/AaronBuxbaum/diveday/actions/runs/<id>/jobs`. Find the dominant cause and fix it in the gate or the workflow, with a failing test first for a script. Done is `node scripts/ci-health.mjs` under both thresholds for a week, plus `pnpm lint`, `pnpm typecheck` and `pnpm check:repo`. Close this issue when the week's check reads healthy.",
  });
}

/**
 * Opens the health issue, comments the week on the open one, or does nothing. Returns `opened`,
 * `commented` or `nothing`. A healthy week leaves an open issue alone: a human closes it.
 */
export function reconcileIssue({ health, since, until, runUrl, tracker, dryRun = false, log }) {
  const over = breaches(health);
  if (over.length === 0) return "nothing";
  const open = tracker
    .listIssues({ label: TRIAGE_LABEL })
    .find((issue) => issue.title === ISSUE_TITLE);
  if (open) {
    tracker.comment(
      open.number,
      `Week ${since} to ${until}: ${over.join(", and ")}.\n\n${renderTable(health)}${runUrl ? `\nRun: ${runUrl}\n` : ""}`,
      { dryRun },
    );
    log(`ci-health: commented on #${open.number}.`);
    return "commented";
  }
  const body = issueBody(health, { since, until, runUrl });
  const { problems } = findIssueProblems({ number: 0, title: ISSUE_TITLE, body });
  if (problems.length > 0) {
    throw new Error(
      `ci-health: the issue body fails check:follow-ups, so it was not filed:\n${problems.join("\n")}`,
    );
  }
  const created = tracker.createIssue(
    { title: ISSUE_TITLE, body, labels: [TRIAGE_LABEL] },
    { dryRun },
  );
  log(`ci-health: opened ${created ? `#${created.number}` : "(dry run)"}.`);
  return "opened";
}

export class TransientGitHubError extends Error {}

/** `gh api <endpoint>` as JSON, bounded; `jq` slims a page inside `gh`. */
export function ghJson(endpoint, jq, { run = runBounded, sleep = sleepSync } = {}) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = run("gh", ["api", endpoint, ...(jq ? ["--jq", jq] : [])], {
      encoding: "utf8",
      maxBuffer: GH_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
    });
    if (
      result?.status === 0 ||
      !/\(HTTP 50[234]\)/.test(String(result?.stderr ?? "")) ||
      attempt === 2
    )
      break;
    sleep(250 * 2 ** attempt);
  }
  if (result?.status !== 0) {
    const why =
      String(result?.stderr ?? "")
        .trim()
        .split("\n")[0] || `gh exited ${result?.status}`;
    const message = `gh api ${endpoint} failed: ${why}`;
    if (/\(HTTP 50[234]\)/.test(String(result?.stderr ?? "")))
      throw new TransientGitHubError(message);
    throw new Error(message);
  }
  return JSON.parse(String(result.stdout ?? "").trim() || "null");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const PR_FIELDS =
  "[.[] | {number, ref: .head.ref, created_at, updated_at, closed_at, merged_at, fork: (.head.repo.full_name != .base.repo.full_name)}]";
const RUN_FIELDS =
  "[.workflow_runs[] | {id, head_sha, status, conclusion, created_at, run_started_at, updated_at, html_url}]";

/** GitHub can 502 on a large job response even while smaller pages work. */
export function readRunJobs(gh, repo, runId) {
  const path = `repos/${repo}/actions/runs/${runId}/jobs`;
  const fields = "[.jobs[] | {id, name, conclusion}]";
  try {
    const first = gh(`${path}?per_page=100`, fields) ?? [];
    if (first.length < 100) return first;
  } catch (error) {
    if (!(error instanceof TransientGitHubError)) throw error;
    console.warn(`ci-health: ${path} failed on the large page; reading smaller pages.`);
  }
  const jobs = [];
  for (let page = 1; page <= 200; page += 1) {
    const batch = gh(`${path}?per_page=5&page=${page}`, fields) ?? [];
    jobs.push(...batch);
    if (batch.length < 5) return jobs;
  }
  throw new Error(`ci-health: ${path} exceeded the 1,000-job pagination bound`);
}

/**
 * The window's pull requests with their runs, jobs and named tests, from GitHub. `gh` is
 * injectable for the tests: `gh(endpoint, jq)` returns parsed JSON.
 */
export function readWeek({ since, gh = ghJson, repo = REPO }) {
  const prs = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch =
      gh(
        `repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
        PR_FIELDS,
      ) ?? [];
    for (const pr of batch) if (pr.updated_at >= since && !pr.fork) prs.push(pr);
    if (batch.length < 100 || batch.at(-1).updated_at < since) break;
  }
  for (const pr of prs) {
    // The branch name goes in unencoded: `claude/foo` is what the endpoint matches on.
    const listed =
      gh(
        `repos/${repo}/actions/workflows/ci.yml/runs?branch=${pr.ref}&event=pull_request&per_page=100`,
        RUN_FIELDS,
      ) ?? [];
    // A branch name reused by a later pull request: only this one's lifetime counts.
    const end = pr.closed_at ?? "9999";
    pr.runs = listed.filter(
      (run) =>
        run.status === "completed" && run.created_at >= pr.created_at && run.created_at <= end,
    );
    for (const run of pr.runs) {
      if (!isRed(run)) continue;
      run.jobs = readRunJobs(gh, repo, run.id);
      run.named = namedTests(
        run.jobs,
        (job) =>
          gh(
            `repos/${repo}/check-runs/${job.id}/annotations?per_page=100`,
            "[.[] | {path, annotation_level, title, message}]",
          ) ?? [],
      );
    }
  }
  return prs;
}

function parseArgs(argv) {
  const args = { days: 7, fileIssue: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--days") args.days = Number(argv[++i]);
    else if (flag === "--summary") args.summary = argv[++i];
    else if (flag === "--run-url") args.runUrl = argv[++i];
    else if (flag === "--file-issue") args.fileIssue = true;
    else if (flag === "--dry-run") args.dryRun = true;
    else throw new Error(`ci-health: unknown argument ${flag}`);
  }
  if (!Number.isFinite(args.days) || args.days <= 0)
    throw new Error("ci-health: --days must be a positive number");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const since = new Date(now.getTime() - args.days * 86_400_000).toISOString();
  const window = { since: since.slice(0, 10), until: now.toISOString().slice(0, 10) };
  const health = computeHealth(readWeek({ since }));
  const over = breaches(health);
  const table = `## CI health\n\n${renderTable(health, window)}\n${
    over.length > 0 ? `Over a threshold: ${over.join(", and ")}.` : "Under both thresholds."
  }\n`;
  process.stdout.write(table);
  if (args.summary) appendFileSync(args.summary, table);
  if (args.fileIssue) {
    reconcileIssue({
      health,
      ...window,
      runUrl: args.runUrl,
      tracker: defaultTracker(),
      dryRun: args.dryRun,
      log: console.log,
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
