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
 * spec failed or `gh` cannot answer, so the nightly simply has nothing to repeat.
 */
import { existsSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

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
        .filter((a) => a.annotation_level === "failure" && SPEC.test(a.path ?? ""))
        .map((a) => a.path),
    );
    for (const spec of specs) counts.set(spec, (counts.get(spec) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([spec]) => exists(spec))
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, max)
    .map(([spec]) => spec);
}

function flag(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
}

const gh = (args) =>
  JSON.parse(readBounded("gh", args, { encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.ghCli }));

function main() {
  const days = flag("--days", 7);
  const max = flag("--max", 8);
  const repo = process.env.GITHUB_REPOSITORY ?? "AaronBuxbaum/diveday";
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  try {
    const runs = gh([
      "api",
      `repos/${repo}/actions/workflows/ci.yml/runs?status=failure&created=>=${since}&per_page=100`,
      "--jq",
      "[.workflow_runs[].id]",
    ]);
    const perJob = [];
    for (const run of runs) {
      const jobs = gh([
        "api",
        `repos/${repo}/actions/runs/${run}/jobs?per_page=100`,
        "--jq",
        '[.jobs[] | select(.conclusion == "failure" and (.name | startswith("Playwright shard"))) | .id]',
      ]);
      for (const job of jobs) {
        perJob.push(gh(["api", `repos/${repo}/check-runs/${job}/annotations?per_page=100`]));
      }
    }
    for (const spec of rankFailedSpecs(perJob, { max, exists: existsSync })) console.log(spec);
  } catch (error) {
    console.error(`e2e-recent-failures: could not read CI history (${error.message})`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
