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
    if (!latest || latest.status !== "completed") continue;
    if (!STALE.has(latest.conclusion) || latest.run_attempt >= MAX_ATTEMPTS) continue;
    picked.push({ pr: layer.number, run: latest.id });
  }
  return picked;
}

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
  const call = async (method, pathname) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${pathname}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`${method} ${pathname}: HTTP ${response.status}`);
    return response.status === 204 || method === "POST" ? null : response.json();
  };
  const stacks = (await call("GET", "stacks?per_page=100")).filter((s) => s.open);
  const pulls = await call("GET", "pulls?state=open&per_page=100");
  const lines = [];
  for (const stack of stacks) {
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
