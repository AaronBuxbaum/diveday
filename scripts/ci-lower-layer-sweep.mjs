#!/usr/bin/env node
import path from "node:path";
// Clears the red or cancelled CI run a lower layer of a stack inherited from when it was the top.
//
// A stack grows upward: while a pull request is the newest layer it is the top, so the gate
// (scripts/ci-stack-gate.mjs) runs its full CI. When the next layer opens, that run is already
// finished red, or was cancelled by the next push, and nothing re-evaluates it. GitHub then
// refuses "Merge as a stack" over `CI result` on a layer CI was meant to skip (2026-11-23,
// stack #4937). Re-running that run makes the gate answer again, now `false`, so every job
// skips and `CI result` reports success in seconds. The top layer is never touched.
import process from "node:process";
import { fileURLToPath } from "node:url";

import { FORCE_LABEL } from "./ci-stack-gate.mjs";

/** A rerun that would fail again must not loop: stop after this many attempts. */
export const MAX_ATTEMPTS = 3;

const STALE = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);

/**
 * Runs worth re-running: the newest CI run on each lower layer's current head that finished
 * red or cancelled. `layers` are open pull requests `{number, head_sha, labels}` below the top.
 */
export function staleRuns(layers, runs) {
  const picked = [];
  for (const layer of layers) {
    if (layer.labels.includes(FORCE_LABEL)) continue;
    const mine = runs
      .filter((run) => run.head_sha === layer.head_sha && run.event === "pull_request")
      .sort((a, b) => b.id - a.id);
    const latest = mine[0];
    if (latest?.status !== "completed") continue;
    if (!STALE.has(latest.conclusion) || latest.run_attempt >= MAX_ATTEMPTS) continue;
    picked.push({ pr: layer.number, run: latest.id });
  }
  return picked;
}

/** A red top older than this, still on the same head, is stuck: nobody is pushing a fix. */
export const STUCK_MINUTES = 20;

/**
 * What to do about a stack's top layer: `retry` a first red run once (flakes), `report` a red run
 * that already had its retry or a cancelled run nothing replaced, `clear` the label once green.
 * `latest` is the newest CI run on the top's current head; null when there is none yet.
 */
export function topAction({ latest, now, labels }) {
  if (!latest || latest.status !== "completed") return { do: "wait" };
  if (latest.conclusion === "success") {
    return labels.includes(STUCK_LABEL) ? { do: "clear" } : { do: "wait" };
  }
  if (!["failure", "timed_out", "cancelled", "startup_failure"].includes(latest.conclusion)) {
    return { do: "wait" };
  }
  const idleMinutes = (now - Date.parse(latest.updated_at)) / 60_000;
  if (idleMinutes < STUCK_MINUTES) return { do: "wait" };
  if (latest.run_attempt < 2) return { do: "retry" };
  return labels.includes(STUCK_LABEL) ? { do: "wait" } : { do: "report" };
}

export const STUCK_LABEL = "ci-stuck";

/** Open pull requests of `stack` below its top, with head sha and label names. */
export function lowerLayers(stack, pulls) {
  const byNumber = new Map(pulls.map((p) => [p.number, p]));
  return stack.pull_requests
    .slice(0, -1)
    .map((p) => byNumber.get(p.number))
    .filter((p) => p && p.state === "open")
    .map((p) => ({
      number: p.number,
      head_sha: p.head.sha,
      labels: (p.labels ?? []).map((l) => l.name),
    }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token } = process.env;
  const call = async (method, pathname, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${pathname}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`${method} ${pathname}: HTTP ${response.status}`);
    return method === "GET" ? response.json() : null;
  };
  const stacks = (await call("GET", "stacks?per_page=100")).filter((s) => s.open);
  const pulls = await call("GET", "pulls?state=open&per_page=100");
  const lines = [];
  for (const stack of stacks) {
    const top = pulls.find((p) => p.number === stack.pull_requests.at(-1).number);
    if (top) {
      const page = await call(
        "GET",
        `actions/runs?head_sha=${top.head.sha}&event=pull_request&per_page=20`,
      );
      const latest = page.workflow_runs
        .filter((run) => run.name === "CI")
        .sort((a, b) => b.id - a.id)[0];
      const labels = (top.labels ?? []).map((l) => l.name);
      const action = topAction({ latest, now: Date.now(), labels });
      try {
        if (action.do === "retry") {
          await call("POST", `actions/runs/${latest.id}/rerun-failed-jobs`);
          lines.push(
            `Retried the failed jobs of run ${latest.id} on top #${top.number} (stack #${stack.number}).`,
          );
        } else if (action.do === "report") {
          const marker = `<!-- ci-stuck:${top.head.sha} -->`;
          await call("POST", `issues/${top.number}/comments`, {
            body: `${marker}\nCI has been ${latest.conclusion} on this top layer of stack #${stack.number} for ${STUCK_MINUTES}+ minutes with no new push, even after one retry. [The run](${latest.html_url}) names what failed. A lower layer cannot merge as a stack until this is green.`,
          });
          await call("POST", `issues/${top.number}/labels`, { labels: [STUCK_LABEL] });
          lines.push(`Reported stuck top #${top.number} (stack #${stack.number}).`);
        } else if (action.do === "clear") {
          await call("DELETE", `issues/${top.number}/labels/${STUCK_LABEL}`);
          lines.push(`Cleared ${STUCK_LABEL} on #${top.number}.`);
        }
      } catch (error) {
        lines.push(`Top #${top.number}: ${error.message}`);
      }
    }
    const layers = lowerLayers(stack, pulls);
    if (!layers.length) continue;
    const runs = [];
    for (const layer of layers) {
      const page = await call(
        "GET",
        `actions/runs?head_sha=${layer.head_sha}&event=pull_request&per_page=20`,
      );
      runs.push(...page.workflow_runs.filter((run) => run.name === "CI"));
    }
    for (const { pr, run } of staleRuns(layers, runs)) {
      try {
        await call("POST", `actions/runs/${run}/rerun`);
        lines.push(`Re-ran CI run ${run} on #${pr} (stack #${stack.number}).`);
      } catch (error) {
        lines.push(`Could not re-run ${run} on #${pr}: ${error.message}`);
      }
    }
  }
  const summary = lines.length
    ? lines.join("\n")
    : "No lower layer carries a red or cancelled CI run.";
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}
