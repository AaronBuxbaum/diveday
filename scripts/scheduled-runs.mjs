// The scheduled workflows nobody is watching, read back to the sessions that can fix them.
//
// "Simulate a day" failed every night from 2026-09-18 to 2026-10-13, 26 runs, on a heading the
// staff home no longer has; the one end-to-end walk of a whole dive day checked nothing for four
// weeks. A scheduled run's failure goes to one inbox and to no session: nothing in
// `session-context.mjs`, `agent-doctor` or `gates` read it, and no issue named it (code review
// 2026-10-13, row 2). So the doctor reads it, and says so at session start, once a workflow's
// last two scheduled runs on main have both failed. One red night can be GitHub's; two running is
// the repository's.
//
// One REST read (`gh api .../actions/runs?event=schedule&branch=main`), cached in the clone's git
// common dir for SCHEDULED_RUNS_TTL_MS so most session starts read a file, bounded well under the
// hook's timeout; any failure is "unknown", never a guess.

import { readFileSync, writeFileSync } from "node:fs";

import { runBounded } from "./subprocess.mjs";
import { repoSlug } from "./tracker.mjs";

export const SCHEDULED_RUNS_TTL_MS = 60 * 60_000;
export const SCHEDULED_RUNS_CACHE = "diveday-scheduled-runs.json";
const SCHEDULED_RUNS_READ_MS = 5_000;
/**
 * `gh`'s own `--jq` keeps only the fields read here: the full page is about a megabyte, past
 * `spawnSync`'s default buffer, and was read back as a failure.
 */
const RUN_FIELDS_JQ = "[.workflow_runs[] | {name, path, status, conclusion, created_at, html_url}]";

/** A conclusion that means the workflow did not do its job. `cancelled` and `skipped` do not count. */
const RED = new Set(["failure", "timed_out", "startup_failure"]);

/** The fields this module reads, from GitHub's run objects, newest first. */
export function slimRuns(runs) {
  return runs
    .filter((run) => run.status === "completed")
    .map((run) => ({
      name: run.name,
      path: run.path,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      url: run.html_url,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Each workflow whose two newest scheduled runs both went red, given `slimRuns`' shape:
 * `{ name, path, streak, since, url }`, where `streak` counts the red runs back to the last green
 * one (as far as the page goes), `since` is the day of the oldest of them, and `url` the newest.
 * Null in, null out.
 */
export function redScheduledWorkflows(runs) {
  if (!Array.isArray(runs)) return null;
  const byPath = new Map();
  const newestFirst = [...runs].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
  for (const run of newestFirst) {
    if (run.conclusion === "cancelled" || run.conclusion === "skipped") continue;
    if (!byPath.has(run.path)) byPath.set(run.path, []);
    byPath.get(run.path).push(run);
  }
  const red = [];
  for (const [workflowPath, list] of byPath) {
    let streak = 0;
    while (streak < list.length && RED.has(list[streak].conclusion)) streak += 1;
    if (streak < 2) continue;
    red.push({
      name: list[0].name,
      path: workflowPath,
      streak,
      since: String(list[streak - 1].createdAt).slice(0, 10),
      url: list[0].url,
    });
  }
  return red.sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name));
}

/** The scheduled runs on main, newest first, or null. `run` is `runBounded`'s shape, injectable. */
export function fetchScheduledRuns({ run = runBounded, repo = repoSlug() } = {}) {
  const result = run(
    "gh",
    [
      "api",
      `repos/${repo}/actions/runs?event=schedule&branch=main&per_page=100`,
      "--jq",
      RUN_FIELDS_JQ,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeoutMs: SCHEDULED_RUNS_READ_MS },
  );
  if (result?.status !== 0) return null;
  try {
    const runs = JSON.parse(String(result.stdout ?? ""));
    return Array.isArray(runs) ? slimRuns(runs) : null;
  } catch {
    return null;
  }
}

/** The cached runs when fresh, else fetched ones (written back), else null. */
export function readScheduledRuns(
  cacheFile,
  { now = Date.now(), fetch = fetchScheduledRuns, read = readFileSync, write = writeFileSync } = {},
) {
  if (cacheFile) {
    try {
      const cached = JSON.parse(read(cacheFile, "utf8"));
      if (now - cached.at <= SCHEDULED_RUNS_TTL_MS && Array.isArray(cached.runs)) {
        return cached.runs;
      }
    } catch {
      // No cache yet, or a torn one: read GitHub.
    }
  }
  const runs = fetch();
  if (!runs) return null;
  if (cacheFile) {
    try {
      write(cacheFile, JSON.stringify({ at: now, runs }));
    } catch {
      // An unwritable cache costs a read next session, nothing more.
    }
  }
  return runs;
}

/** "Simulate a day red 26 scheduled runs running (since 2026-09-18)", joined; "" when none. */
export function redScheduledText(red) {
  if (!Array.isArray(red) || red.length === 0) return "";
  return red
    .map(
      (workflow) =>
        `scheduled ${workflow.name} red ${workflow.streak} runs running (since ${workflow.since})`,
    )
    .join("; ");
}
