// Cancel every GitHub Actions run that has not finished: queued, in progress, waiting and pending.
//
//   pnpm cancel:actions --dry-run          # list what would be cancelled, change nothing
//   pnpm cancel:actions                    # cancel them all
//   pnpm cancel:actions --branch <name>    # only runs on that branch
//
// Uses `gh api` over REST (the GraphQL `gh pr list` is blocked in cloud sessions) and needs `gh`
// authenticated with the `actions: write` scope. Every call is bounded. A run that finishes between
// the list and the cancel answers 409, which counts as already done, not as a failure.

import process from "node:process";
import { pathToFileURL } from "node:url";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export const REPO = "AaronBuxbaum/diveday";
/** The run statuses that mean "not finished". The list endpoint takes one status per call. */
export const UNFINISHED_STATUSES = ["queued", "in_progress", "waiting", "pending", "requested"];

export function parseArgs(argv) {
  const options = { dryRun: false, branch: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--branch") {
      const value = argv[(i += 1)];
      if (!value || value.startsWith("--")) throw new Error("--branch needs a branch name");
      options.branch = value;
    } else if (arg.startsWith("--branch=")) options.branch = arg.slice("--branch=".length);
    else throw new Error(`unknown argument ${arg}; try --help`);
  }
  return options;
}

/** The REST path listing one page of runs in one status. */
export function listEndpoint(status, { branch, page }) {
  const query = new URLSearchParams({ status, per_page: "100", page: String(page) });
  if (branch) query.set("branch", branch);
  return `repos/${REPO}/actions/runs?${query}`;
}

export function cancelEndpoint(runId) {
  return `repos/${REPO}/actions/runs/${runId}/cancel`;
}

/** Collapse run lists from several statuses into one list, one entry per run id. */
export function mergeRuns(lists) {
  const byId = new Map();
  for (const run of lists.flat()) byId.set(run.id, run);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export function describeRun(run) {
  return `#${run.id} ${run.name ?? "(unnamed)"} [${run.status}] ${run.head_branch ?? "-"} ${run.html_url ?? ""}`.trim();
}

function gh(args, { method = "GET" } = {}) {
  const result = runBounded("gh", ["api", "-X", method, ...args], {
    timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
    encoding: "utf8",
  });
  return result;
}

function listRuns(status, branch) {
  const runs = [];
  for (let page = 1; ; page += 1) {
    const result = gh([listEndpoint(status, { branch, page }), "--jq", ".workflow_runs"]);
    if (result.status !== 0) {
      throw new Error(`listing ${status} runs failed: ${(result.stderr || "").trim() || `exit ${result.status}`}`);
    }
    const batch = JSON.parse(result.stdout || "[]");
    runs.push(...batch);
    if (batch.length < 100) return runs;
  }
}

/** POST the cancel. 409 means the run already finished or is already cancelling. */
function cancelRun(run) {
  const result = gh([cancelEndpoint(run.id)], { method: "POST" });
  if (result.status === 0) return "cancelled";
  if (/HTTP 409/.test(result.stderr || "")) return "already-finished";
  return `failed: ${(result.stderr || "").trim() || `exit ${result.status}`}`;
}

const HELP = `Usage: pnpm cancel:actions [--dry-run] [--branch <name>]
Cancels every queued, in-progress, waiting and pending workflow run in ${REPO}.
  --dry-run        list the runs that would be cancelled and change nothing
  --branch <name>  only runs on that branch`;

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  let runs;
  try {
    runs = mergeRuns(UNFINISHED_STATUSES.map((status) => listRuns(status, options.branch)));
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const scope = options.branch ? ` on ${options.branch}` : "";
  if (runs.length === 0) {
    console.log(`No unfinished runs${scope}.`);
    return 0;
  }
  console.log(`${options.dryRun ? "Would cancel" : "Cancelling"} ${runs.length} run(s)${scope}:`);
  let failures = 0;
  for (const run of runs) {
    if (options.dryRun) {
      console.log(`  ${describeRun(run)}`);
      continue;
    }
    const outcome = cancelRun(run);
    if (outcome.startsWith("failed")) failures += 1;
    console.log(`  ${outcome}: ${describeRun(run)}`);
  }
  if (failures > 0) console.error(`${failures} run(s) could not be cancelled.`);
  return failures > 0 ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main();
}
