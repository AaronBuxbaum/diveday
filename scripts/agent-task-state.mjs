import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { appendMetric } from "./task-metrics.mjs";

/**
 * One state file per branch, `.agent-out/task-state/<branch>.json`: sessions share a checkout,
 * and a single `.agent-out/task-state.json` was overwritten by whichever saved last.
 */
export function statePath(root, branch) {
  const slug = (branch || "detached").replace(/[^\w.-]+/g, "_");
  return path.join(root, ".agent-out", "task-state", `${slug}.json`);
}

/** The checked-out branch, or null (detached HEAD, not a repository). */
export function currentBranch(root) {
  try {
    return (
      readBounded("git", ["branch", "--show-current"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export function validateState(state) {
  const errors = [];
  if (state?.unreadable) return [`state file is unreadable: ${state.unreadable}`];
  if (!state || typeof state !== "object" || Array.isArray(state))
    return ["state must be an object"];
  if (state.version !== 1) errors.push("version must be 1");
  for (const key of ["task", "owner", "nextCommand", "baseSha", "headSha"])
    if (typeof state[key] !== "string" || !state[key].trim()) errors.push(`${key} is required`);
  for (const key of ["baseSha", "headSha"])
    if (!/^[a-f0-9]{40,64}$/.test(state[key] ?? "")) errors.push(`${key} must be an immutable SHA`);
  for (const key of [
    "ownedPaths",
    "decisions",
    "checks",
    "visualEvidence",
    "processes",
    "pending",
    "blockers",
  ])
    if (!Array.isArray(state[key])) errors.push(`${key} must be an array`);
  for (const decision of Array.isArray(state.decisions) ? state.decisions : [])
    if (!decision?.text || !decision?.source)
      errors.push("each decision needs exact text and source");
  for (const process of Array.isArray(state.processes) ? state.processes : [])
    if (
      !process ||
      !Number.isInteger(process.pid) ||
      process.pid <= 0 ||
      !process.owner ||
      !process.command
    )
      errors.push("each process needs positive pid, owner and command");
  for (const check of Array.isArray(state.checks) ? state.checks : [])
    if (
      !check?.command ||
      !["passed", "failed", "pending"].includes(check.result) ||
      !/^[a-f0-9]{40,64}$/.test(check.headSha ?? "")
    )
      errors.push("each check needs command, result (passed/failed/pending) and headSha");
  for (const evidence of Array.isArray(state.visualEvidence) ? state.visualEvidence : [])
    if (
      !["capture", "route", "viewport", "state", "artifact", "headSha"].every(
        (key) => typeof evidence?.[key] === "string" && evidence[key],
      )
    )
      errors.push(
        "each visual evidence needs capture, route, viewport, state, artifact and headSha",
      );
  return errors;
}

export function inspectState(
  state,
  headSha,
  alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
) {
  const errors = validateState(state);
  if (errors.length) return { errors, headChanged: null, processes: [] };
  return {
    errors,
    headChanged: state.headSha !== headSha,
    processes: (state.processes ?? []).map((item) => ({ ...item, alive: alive(item.pid) })),
  };
}

/**
 * This branch's saved state, null when there is none, or `{ unreadable }` when the file is not
 * JSON, so bootstrap reports it instead of throwing.
 */
export function readState(root = process.cwd(), branch = currentBranch(root)) {
  const file = statePath(root, branch);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return { unreadable: `${path.relative(root, file)}: ${error.message}` };
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return { unreadable: `${path.relative(root, file)}: ${error.message}` };
  }
}

export function gitSha(root, ref) {
  return readBounded("git", ["rev-parse", "--verify", ref], {
    cwd: root,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  }).trim();
}

/** Save first, then observe now. The ledger deduplicates repeated saves by task identity. */
export function saveTaskState(
  root,
  state,
  { resolveSha = gitSha, record = appendMetric, branch = currentBranch(root) } = {},
) {
  const errors = validateState(state);
  if (errors.length) throw new Error(errors.join("; "));
  for (const ref of [state.baseSha, state.headSha]) resolveSha(root, `${ref}^{commit}`);
  const file = statePath(root, branch);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  try {
    return {
      metric: record(
        {
          task: state.task,
          event: "started",
          eventId: `started:${state.task}`,
          provider: state.provider ?? "unknown",
          taskClass: state.taskClass ?? "unknown",
          sha: state.headSha,
          baseSha: state.baseSha,
          evidence: `${path.relative(root, file)} (first observed save; not historical task start)`,
        },
        { root },
      ),
    };
  } catch (error) {
    // A metrics filesystem problem must not discard the durable handoff. A subsequent save retries.
    return { metricError: error.message };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const input = process.argv[2];
  if (!input) {
    const state = readState(root);
    console.log(
      JSON.stringify(
        state
          ? { state, ...inspectState(state, gitSha(root, "HEAD")) }
          : {
              usage:
                "pnpm task:state <prepared-state.json> validates and saves .agent-out/task-state/<branch>.json",
              template: {
                version: 1,
                task: "",
                owner: "",
                baseSha: "",
                headSha: gitSha(root, "HEAD"),
                ownedPaths: [],
                decisions: [],
                checks: [],
                visualEvidence: [],
                processes: [],
                pending: [],
                blockers: [],
                nextCommand: "",
              },
            },
        null,
        2,
      ),
    );
  } else {
    const state = JSON.parse(readFileSync(input, "utf8"));
    const result = saveTaskState(root, state);
    if (result.metricError)
      console.error(`State saved, start metric unavailable: ${result.metricError}`);
    console.log(
      `Saved ${path.relative(root, statePath(root, currentBranch(root)))}; keep it with this checkout when handing off.`,
    );
  }
}
