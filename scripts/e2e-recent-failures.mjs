#!/usr/bin/env node
/**
 * The Playwright specs that failed on CI in the last few days, most failures first, one path
 * per line: the input to the nightly flake hunt (`--repeat-each=5` in
 * .github/workflows/e2e-nightly.yml, testing review decision 4, 2026-10-14).
 *
 * It reads what CI already recorded rather than any artifact: each failed
 * `Playwright shard` job's check-run annotations, which Playwright's `github` reporter writes
 * with the failing spec's path. Pull request runs count too: a spec that broke for real on a
 * branch passes its five repeats on main and costs only the minutes; a flake fails one of them.
 *
 *   node scripts/e2e-recent-failures.mjs [--days 7] [--max 8]
 *
 * Needs `gh` with `actions: read` and `checks: read`. Prints nothing (and exits 0) when no
 * spec failed. History lookup failures exit nonzero; they are never an empty history.
 */
import { existsSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { GH_MAX_BUFFER } from "./tracker.mjs";

const SPEC = /^e2e\/.+\.spec\.ts$/;

/**
 * Spec paths ranked by how many failed jobs named them (ties by path), capped at `max`.
 * `annotationsPerJob` is one array of `{ path, annotation_level }` per failed job; a spec
 * counts once per job however many of its tests failed there.
 */
export function rankFailedSpecs(annotationsPerJob, { max = 8, exists = () => true } = {}) {
  const counts = new Map();
  for (const annotations of annotationsPerJob) {
    const specs = new Set(
      annotations
        .filter((a) => a.annotation_level === "failure")
        .map(annotationSpec)
        .filter(Boolean),
    );
    for (const spec of specs) counts.set(spec, (counts.get(spec) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([spec]) => exists(spec))
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, max)
    .map(([spec]) => spec);
}

/**
 * Spec paths in the order the failed jobs first named them, newest first, capped at `max`:
 * the fast lane's fill (`scripts/fast-lane.mjs`). `annotationsPerJob` is in
 * {@link readFailureHistory}'s order, which is the API's: the newest failed run first.
 */
export function newestFailedSpecs(annotationsPerJob, { max = 8, exists = () => true } = {}) {
  const seen = [];
  for (const annotations of annotationsPerJob) {
    for (const a of annotations) {
      if (a.annotation_level !== "failure") continue;
      const spec = annotationSpec(a);
      if (spec && !seen.includes(spec) && exists(spec)) seen.push(spec);
    }
  }
  return seen.slice(0, max);
}

// Playwright's GitHub reporter title contains the test's declaration identity;
// annotation.path can instead be the helper frame where the assertion threw.
export function annotationSpec(annotation) {
  const identity = stripVTControlCharacters(annotation.title ?? "");
  const match = identity.match(
    /(?:^|[\s›])(?:.*?\/)?(e2e\/[^\s:›]+\.spec\.ts):\d+(?::\d+)?(?:\s|$)/,
  );
  if (match) return match[1];
  return SPEC.test(annotation.path ?? "") ? annotation.path : null;
}

/** Fetch all pages, rejecting a partial lookup instead of publishing partial history. */
export function pages(endpoint, key, request) {
  const items = [];
  for (let page = 1; page <= 1000; page++) {
    const response = request(
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const rows = key === null ? response : response[key];
    if (!Array.isArray(rows)) throw new Error(`Malformed history response: ${endpoint}`);
    items.push(...rows);
    if (rows.length < 100) return items;
  }
  throw new Error(`History pagination exceeded safety limit: ${endpoint}`);
}

/**
 * Every failed shard job's annotations since `since`, newest run first. `maxRuns` reads only the
 * newest few runs' jobs, for a caller on a budget (the fast lane reads 10).
 */
export function readFailureHistory(repo, since, request, { maxRuns = Infinity } = {}) {
  const runs = pages(
    `repos/${repo}/actions/workflows/ci.yml/runs?status=failure&created=>=${since}`,
    "workflow_runs",
    request,
  );
  const perJob = [];
  for (const run of runs.slice(0, maxRuns)) {
    const jobs = pages(`repos/${repo}/actions/runs/${run.id}/jobs`, "jobs", request);
    for (const job of jobs.filter(
      (job) =>
        job.conclusion === "failure" && /^(?:Playwright shard|Visual capture shard)/.test(job.name),
    )) {
      perJob.push(pages(`repos/${repo}/check-runs/${job.id}/annotations`, null, request));
    }
  }
  return { perJob, runCount: runs.length };
}

function flag(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
}

/**
 * One `gh api` page, parsed. A page of 100 workflow runs passes execFileSync's default 1 MiB
 * buffer (1.27 MB on 2026-10-23, which killed gh with ENOBUFS and the flake hunt with it), so
 * the buffer is the one the tracker uses for its own 100-row pages.
 */
export function ghJson(endpoint, read = readBounded) {
  return JSON.parse(
    read("gh", ["api", endpoint], {
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
      maxBuffer: GH_MAX_BUFFER,
    }),
  );
}

function main() {
  const days = flag("--days", 7);
  const max = flag("--max", 8);
  const repo = process.env.GITHUB_REPOSITORY ?? "AaronBuxbaum/diveday";
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  try {
    const { perJob, runCount } = readFailureHistory(repo, since, (endpoint) => ghJson(endpoint));
    console.error(
      `e2e-recent-failures: inspected ${runCount} failed CI runs since ${since}; Playwright and visual shards`,
    );
    for (const spec of rankFailedSpecs(perJob, { max, exists: existsSync })) console.log(spec);
  } catch (error) {
    console.error(`e2e-recent-failures: could not read CI history (${error.message})`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
