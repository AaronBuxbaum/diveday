#!/usr/bin/env node
// What CI's "Fast lane" job runs first, so a pull request hears from a browser in minutes.
//
// The first browser verdict on a pull request used to be its slowest one: the build, then six
// Playwright shards and the visual capture shards of ~10 minutes each, so ~22 minutes for the
// median run (2026-10-22 review of 2026-10-19 to 10-22, p90 37). And the specs most likely to be
// red were known before any shard started: 25 of 30 red runs had a red Playwright shard, and 14 of
// the 18 pushes that came back red after a red run were red again on a test that run had already
// named. So right after the build, one runner runs two short lists:
//
//   own    — the spec files and the capture titles the branch's latest finished red CI run
//            named (`scripts/own-ci.mjs`, the same reading `verify:push` replays), up to
//            {@link OWN_BUDGET_MS} of recorded CI time.
//   strong — the `strong` tier of `scripts/e2e-affected.mjs` against the pull request's base: a
//            spec the diff edits, one quoting text it removed, one visiting a route it edits,
//            and the smoke tests. Up to {@link FAST_LANE_BUDGET_MS}: edited specs first, then
//            the other strong picks, then smoke, each tier cheapest first.
//
//   fill   — what the strong tier left of {@link FAST_LANE_BUDGET_MS} (2026-10-24): first the
//            repository's recent-failure specs, newest first, at most {@link HOT_MAX}
//            (`scripts/e2e-recent-failures.mjs`, the nightly flake hunt's reading), then the
//            tests the last main run measured over {@link NEAR_BUDGET_SHARE} of their own budget
//            (its `e2e test at N% of its budget` annotations). The red runs of the week were
//            mostly red on the same few specs, on whichever branch ran them; this runs them
//            before the shards do. Either reading fails open: GitHub unreachable leaves that
//            list empty, and the summary says so.
//
// Everything else is left to the shards, which run it all anyway: the fast lane never decides
// green. It is a report that arrives early, under its own check name.
//
//   node scripts/fast-lane.mjs --base origin/<base> [--branch <head> --repo <owner/name>]
//     [--out <dir>] [--summary <file>] [--github-output]
//
// Writes `<out>/specs.txt` (one spec file or `file:line` a line) and `<out>/grep.txt` (the light-
// mode `-g` for the captures, or empty). Anything it cannot read (no base, no `gh`) leaves that
// list empty and says so; it never throws on missing evidence.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  affectedSpecs,
  captureGrep,
  captureMs,
  durations,
  UNRECORDED_MS,
} from "./e2e-affected.mjs";
import { newestFailedSpecs, pages, readFailureHistory } from "./e2e-recent-failures.mjs";
import { readOwnVerdict } from "./own-ci.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { isVisualSpec } from "./visual-specs.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Recorded CI milliseconds the strong tier may spend: "about 4 CI-minutes", the unit
 * `e2e-affected.mjs` prints. At the job's two workers that is about two minutes of wall clock on
 * top of the ~85 s every browser job pays to start (ci.yml's playwright job).
 */
export const FAST_LANE_BUDGET_MS = 4 * 60_000;

/**
 * Recorded CI milliseconds the previous red run's own tests may spend. Larger than the strong
 * budget, since these failed once already, but bounded so a run that named half the suite
 * cannot turn one runner into a seventh shard.
 */
export const OWN_BUDGET_MS = 8 * 60_000;

/** A `file:line` pick (a smoke test) costs one test, not its whole spec. */
export const ONE_TEST_MS = 60_000;

/** How many recent-failure specs the fill reads, newest first. */
export const HOT_MAX = 8;

/** A main-run test this close to its own budget is the next timeout: the fill runs it. */
export const NEAR_BUDGET_SHARE = 0.9;

const LINE_PICK = /:\d+$/;

/** Recorded CI milliseconds for one pick: a spec file, or one test as `file:line`. */
export function pickCost(pick, record) {
  if (LINE_PICK.test(pick)) {
    return Math.min(record[pick.replace(LINE_PICK, "")] ?? UNRECORDED_MS, ONE_TEST_MS);
  }
  return record[pick] ?? UNRECORDED_MS;
}

/** 0 for a spec the diff edits, 2 for a smoke test, 1 for every other strong pick. */
function tier(why) {
  if (why.includes("edited")) return 0;
  if (why.length > 0 && why.every((reason) => reason === "smoke")) return 2;
  return 1;
}

/**
 * The fast lane's lists.
 *
 * `strong` maps a pick to its reasons (a Map of Sets, or an object of arrays, as the CLI's JSON);
 * `own` is `{ specs, captures }` from `readOwnVerdict` (absent when unknown or green); `record`
 * the `functional` durations; `captureCost(title)` the recorded ms for one light-mode capture;
 * `exists(file)` whether a spec is still in the tree.
 *
 * `hot` (recent-failure spec files, newest first) and `slow` (`file:line` tests near their
 * budget on main) fill what the strong tier left of `budgetMs`, in that order; a pick that does
 * not fit is skipped, never listed in `left`, since nothing in the diff asked for it.
 *
 * Returns `{ specs, captures, left, strongMs, ownMs, fillMs, filled }`: `specs` to run (own
 * first), `captures` titles to run, `left` the picks the budgets left to the shards, `filled` the
 * fill's picks (also in `specs`).
 */
export function planFastLane({
  strong = new Map(),
  own = {},
  record = {},
  captureCost = () => 0,
  exists = () => true,
  hot = [],
  slow = [],
  budgetMs = FAST_LANE_BUDGET_MS,
  ownBudgetMs = OWN_BUDGET_MS,
}) {
  const specs = [];
  const captures = [];
  const left = [];
  let ownMs = 0;
  const chosen = new Set();

  const ownSpecs = [...new Set(own.specs ?? [])]
    .filter(exists)
    .sort((a, b) => pickCost(a, record) - pickCost(b, record) || a.localeCompare(b));
  for (const spec of ownSpecs) {
    const cost = pickCost(spec, record);
    if (ownMs + cost > ownBudgetMs) {
      left.push(spec);
      continue;
    }
    specs.push(spec);
    chosen.add(spec);
    ownMs += cost;
  }
  for (const title of [...new Set(own.captures ?? [])].sort()) {
    const cost = captureCost(title);
    if (ownMs + cost > ownBudgetMs) {
      left.push(`capture: ${title}`);
      continue;
    }
    captures.push(title);
    ownMs += cost;
  }

  const entries = (strong instanceof Map ? [...strong] : Object.entries(strong)).map(
    ([pick, why]) => ({ pick, why: [...why] }),
  );
  const ordered = entries
    .filter(({ pick }) => exists(pick.replace(LINE_PICK, "")))
    .sort(
      (a, b) =>
        tier(a.why) - tier(b.why) ||
        pickCost(a.pick, record) - pickCost(b.pick, record) ||
        a.pick.localeCompare(b.pick),
    );
  let strongMs = 0;
  for (const { pick } of ordered) {
    const file = pick.replace(LINE_PICK, "");
    if (chosen.has(pick) || chosen.has(file)) continue;
    const cost = pickCost(pick, record);
    if (strongMs + cost > budgetMs) {
      left.push(pick);
      continue;
    }
    specs.push(pick);
    chosen.add(pick);
    strongMs += cost;
  }
  // The fill: what the diff's picks left of the budget, hot specs first, in the order given.
  let fillMs = 0;
  const filled = [];
  for (const pick of [...hot, ...slow]) {
    const file = pick.replace(LINE_PICK, "");
    if (chosen.has(pick) || chosen.has(file) || isVisualSpec(file) || !exists(file)) continue;
    const cost = pickCost(pick, record);
    if (strongMs + fillMs + cost > budgetMs) continue;
    specs.push(pick);
    filled.push(pick);
    chosen.add(pick);
    fillMs += cost;
  }
  // A `file:line` whose whole file was chosen after it is already covered.
  const runs = specs.filter(
    (pick) => !LINE_PICK.test(pick) || !chosen.has(pick.replace(LINE_PICK, "")),
  );
  return {
    specs: runs,
    captures,
    left,
    strongMs,
    ownMs,
    fillMs,
    filled: filled.filter((pick) => runs.includes(pick)),
  };
}

/** `gh api <endpoint>`, parsed, bounded. */
const ghApi = (endpoint) =>
  JSON.parse(
    readBounded("gh", ["api", endpoint], {
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
    }),
  );

/**
 * The repository's recent-failure specs, newest first: failed Playwright and visual shard jobs
 * of the last three days' newest ten failed runs. `{ specs }` or `{ unknown }`, never a throw.
 */
export function readHotSpecs(
  repo,
  { request = ghApi, exists = () => true, now = Date.now() } = {},
) {
  const since = new Date(now - 3 * 86_400_000).toISOString().slice(0, 10);
  try {
    const { perJob } = readFailureHistory(repo, since, request, { maxRuns: 10 });
    return { specs: newestFailedSpecs(perJob, { max: HOT_MAX, exists }) };
  } catch (error) {
    return { unknown: `CI history unreadable: ${error.message}` };
  }
}

/**
 * The tests the newest finished push run of main measured over {@link NEAR_BUDGET_SHARE} of their
 * own budget, as `file:line`, from the `e2e test at N% of its budget` annotations its Playwright
 * shards wrote (`scripts/e2e-budget-report.mjs --annotate`). `{ picks }` or `{ unknown }`.
 */
export function readNearBudget(repo, { request = ghApi, share = NEAR_BUDGET_SHARE } = {}) {
  try {
    const { workflow_runs: runs } = request(
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=1`,
    );
    const run = runs?.[0];
    if (!run) return { unknown: "no finished main run" };
    const jobs = pages(`repos/${repo}/actions/runs/${run.id}/jobs`, "jobs", request);
    const picks = [];
    for (const job of jobs.filter((item) => /^Playwright shard/.test(item.name))) {
      for (const a of pages(`repos/${repo}/check-runs/${job.id}/annotations`, null, request)) {
        const used = Number(a.title?.match(/^e2e test at (\d+)% of its budget$/)?.[1]);
        if (used >= share * 100 && /^e2e\/.+\.spec\.ts$/.test(a.path ?? "")) {
          picks.push({ pick: `${a.path}:${a.start_line}`, used });
        }
      }
    }
    picks.sort((a, b) => b.used - a.used || a.pick.localeCompare(b.pick));
    return { picks: [...new Set(picks.map(({ pick }) => pick))], sha: run.head_sha };
  } catch (error) {
    return { unknown: `main's last run unreadable: ${error.message}` };
  }
}

/** The job summary: what runs, why, and what the shards answer instead. */
export function renderSummary({ plan, ownLine, strongLine, hotLine, slowLine }) {
  const minutes = (ms) => (ms / 60_000).toFixed(1);
  const lines = [
    "### Fast lane",
    "",
    "An early report only: the Playwright and visual capture shards still decide this run.",
    "",
    `- Previous red run: ${ownLine}`,
    `- Diff: ${strongLine}`,
    ...(hotLine ? [`- Recent failures: ${hotLine}`] : []),
    ...(slowLine ? [`- Near budget on main: ${slowLine}`] : []),
    `- Runs ${plan.specs.length} spec pick(s) and ${plan.captures.length} capture(s), about ` +
      `${minutes(plan.ownMs + plan.strongMs + (plan.fillMs ?? 0))} recorded CI-minutes` +
      `${plan.filled?.length ? `, ${plan.filled.length} of them the fill` : ""}.`,
  ];
  if (plan.specs.length > 0) lines.push("", ...plan.specs.map((pick) => `  - \`${pick}\``));
  if (plan.captures.length > 0)
    lines.push("", ...plan.captures.map((title) => `  - capture: ${title}`));
  if (plan.left.length > 0)
    lines.push("", `Left to the shards by the budget: ${plan.left.length} pick(s).`);
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { out: "fast-lane", githubOutput: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--base") args.base = argv[++i];
    else if (flag === "--branch") args.branch = argv[++i];
    else if (flag === "--repo") args.repo = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--summary") args.summary = argv[++i];
    else if (flag === "--github-output") args.githubOutput = true;
    else throw new Error(`fast-lane: unknown argument ${flag}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const affected = args.base ? affectedSpecs({ base: args.base }) : null;
  const strongLine = affected
    ? `${affected.strong.size} strong pick(s) against ${affected.base}.`
    : "git could not name a base to diff against, so no strong picks.";

  const verdict =
    args.branch && args.repo
      ? readOwnVerdict(args.branch, { repo: args.repo })
      : { unknown: "no branch or repository given" };
  let ownLine;
  if (verdict.unknown) ownLine = `unknown (${verdict.unknown}).`;
  else if (verdict.green) ownLine = `green (${verdict.sha.slice(0, 9)}).`;
  else
    ownLine =
      `red (${verdict.sha.slice(0, 9)}): ${verdict.specs.length} spec(s), ` +
      `${verdict.captures.length} capture(s) named. ${verdict.url ?? ""}`.trimEnd();

  const exists = (file) => existsSync(path.join(ROOT, file));
  const hot = args.repo ? readHotSpecs(args.repo, { exists }) : { unknown: "no repository given" };
  const slow = args.repo ? readNearBudget(args.repo) : { unknown: "no repository given" };
  const hotLine = hot.unknown
    ? `skipped (${hot.unknown}).`
    : `${hot.specs.length} spec(s) named by the newest failed runs.`;
  const slowLine = slow.unknown
    ? `skipped (${slow.unknown}).`
    : `${slow.picks.length} test(s) over ${NEAR_BUDGET_SHARE * 100}% of their budget on ${slow.sha?.slice(0, 9)}.`;

  const plan = planFastLane({
    strong: affected?.strong ?? new Map(),
    own: verdict.unknown || verdict.green ? {} : verdict,
    record: durations(),
    captureCost: (title) => captureMs([title]),
    exists,
    hot: hot.specs ?? [],
    slow: slow.picks ?? [],
  });

  mkdirSync(args.out, { recursive: true });
  writeFileSync(path.join(args.out, "specs.txt"), plan.specs.map((pick) => `${pick}\n`).join(""));
  const grep = captureGrep(plan.captures) ?? "";
  writeFileSync(path.join(args.out, "grep.txt"), grep);

  const summary = renderSummary({ plan, ownLine, strongLine, hotLine, slowLine });
  process.stdout.write(summary);
  if (args.summary) appendFileSync(args.summary, summary);
  if (args.githubOutput && process.env.GITHUB_OUTPUT) {
    const run = plan.specs.length > 0 || plan.captures.length > 0;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `run=${run}\nspecs=${plan.specs.length > 0}\ncaptures=${grep !== ""}\n`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
