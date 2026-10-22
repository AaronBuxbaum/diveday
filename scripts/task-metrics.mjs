// Local explicit observations; no token usage or elapsed delivery time is guessed.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitReader } from "./stack-map.mjs";
export function metricRecord(input, now = new Date().toISOString()) {
  const allowed = ["started", "verified", "ci-failed", "ci-green", "merged", "correction", "usage"];
  if (!input.task || !allowed.includes(input.event))
    throw new Error(
      "Provide task and event: started|verified|ci-failed|ci-green|merged|correction|usage",
    );
  if (
    input.tokens != null &&
    (!Number.isSafeInteger(input.tokens) || input.tokens < 0 || !input.usageSource)
  )
    throw new Error("Tokens require a nonnegative observed count and usageSource.");
  if (input.usage != null) {
    if (!input.usageSource || !input.eventId)
      throw new Error("Detailed usage requires usageSource and a unique eventId.");
    for (const key of ["cachedInput", "uncachedInput", "output"])
      if (
        input.usage[key] != null &&
        (!Number.isSafeInteger(input.usage[key]) || input.usage[key] < 0)
      )
        throw new Error("Usage counts must be nonnegative observed integers or null.");
  }
  return {
    version: 1,
    at: now,
    task: input.task,
    event: input.event,
    provider: input.provider ?? "unknown",
    taskClass: input.taskClass ?? "unknown",
    sha: input.sha ?? null,
    baseSha: input.baseSha ?? null,
    eventId: input.eventId ?? null,
    usage: input.usage ?? null,
    tokens: input.tokens ?? null,
    usageSource: input.usageSource ?? null,
    failureClass: input.failureClass ?? null,
    evidence: input.evidence ?? null,
  };
}
export function appendMetric(input, { root = process.cwd(), git = gitReader(root) } = {}) {
  const dir = git(["rev-parse", "--git-path", "diveday-metrics"]);
  if (!dir) throw new Error("Run inside a Git worktree.");
  const file = path.resolve(root, dir, "events.jsonl");
  const record = metricRecord({ sha: git(["rev-parse", "HEAD"]), ...input });
  mkdirSync(path.dirname(file), { recursive: true });
  let rows = [];
  try {
    rows = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {}
  if (record.eventId && rows.some((row) => row.eventId === record.eventId))
    return { file, recorded: false };
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  return { file, recorded: true };
}
export function ciObservation(manifest, state) {
  if (
    !manifest.runId ||
    !manifest.attempt ||
    !manifest.headSha ||
    !Array.isArray(manifest.jobs) ||
    manifest.jobs.length === 0
  )
    throw new Error("CI manifest lacks attempt identity or job outcomes.");
  const results = manifest.jobs.map((job) => job.result);
  if (results.some((result) => !["success", "skipped", "failure", "cancelled"].includes(result)))
    throw new Error("CI attempt is incomplete.");
  return {
    task: state.task,
    provider: state.provider ?? "unknown",
    taskClass: state.taskClass ?? "unknown",
    event: results.some((result) => ["failure", "cancelled"].includes(result))
      ? "ci-failed"
      : "ci-green",
    sha: manifest.headSha,
    baseSha: manifest.baseSha,
    eventId: `${manifest.url ?? "ci"}:${manifest.runId}:${manifest.attempt}`,
    evidence: manifest.url,
  };
}
function main() {
  const git = gitReader(process.cwd());
  const dir = git(["rev-parse", "--git-path", "diveday-metrics"]);
  if (!dir) throw new Error("Run inside a Git worktree.");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "events.jsonl");
  if (process.argv[2] === "--report") {
    let rows = [];
    try {
      rows = readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {}
    const seen = new Set();
    rows = rows.filter((row) => {
      if (!row.eventId) return true;
      if (seen.has(row.eventId)) return false;
      seen.add(row.eventId);
      return true;
    });
    const tasks = [...new Set(rows.map((row) => row.task))].map((task) => {
      const events = rows.filter((row) => row.task === task);
      const started = events.find((row) => row.event === "started");
      const green = events.find((row) => row.event === "ci-green");
      const merged = events.find((row) => row.event === "merged");
      return {
        task,
        provider: started?.provider ?? "unknown",
        taskClass: started?.taskClass ?? "unknown",
        firstGreenMs: started && green ? Date.parse(green.at) - Date.parse(started.at) : null,
        mergeMs: started && merged ? Date.parse(merged.at) - Date.parse(started.at) : null,
        ciFailures: events.filter((row) => row.event === "ci-failed").length,
        usage: Object.fromEntries(
          ["cachedInput", "uncachedInput", "output"].map((key) => [
            key,
            events.some((row) => row.usage?.[key] != null)
              ? events.reduce((sum, row) => sum + (row.usage?.[key] ?? 0), 0)
              : null,
          ]),
        ),
        corrections: events.filter((row) => row.event === "correction").length,
        summedLegacyTokenEvents: events.some((row) => row.tokens != null)
          ? events.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
          : null,
      };
    });
    console.log(
      JSON.stringify(
        {
          tasks,
          limitations:
            "Explicit local observations only; missing events and usage are unknown, not zero. Compare matching provider/taskClass cohorts.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (process.argv[2] === "--import-ci") {
    const manifest = JSON.parse(readFileSync(process.argv[3], "utf8"));
    const state = JSON.parse(readFileSync(".agent-out/task-state.json", "utf8"));
    console.log(appendMetric(ciObservation(manifest, state)));
    return;
  }
  const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
  appendMetric(input, { git });
  console.log(file);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
