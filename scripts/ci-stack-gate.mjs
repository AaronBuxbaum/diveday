#!/usr/bin/env node
// Decides whether this pull request's CI run should happen at all (ADR 20261105-ci-runs-on-the-top-of-the-stack).
//
// The account has a fixed number of concurrent runners and Aaron merges a whole stack from its top,
// so the top layer is the one run worth paying for; a slice of CI on every layer only delays the
// answer. This prints `run=true` or `run=false` to $GITHUB_OUTPUT. It is fail-open: any doubt (no
// stack, an API error, a registration that never arrives) answers `true`, because an untested
// change is worse than a wasted run.
//
// It also names the stack's **diff base**: the base sha of the stack's lowest pull request that
// has not merged, which is where what is left of the stack leaves the default branch. A layer that
// merged stays in the stack's record, and its base is the default branch as it was before any of
// the stack landed: diffing against that blamed the top layer for rule edits already merged
// (#4904, 2026-11-22). Change detection and the pull-request body check
// diff against it instead of against the layer below, because only the top layer runs CI and a
// diff against the layer below would never see infra, migration or safety changes in the layers
// under it. Empty for a standalone pull request, which keeps its event-pinned base.
// Uncertain stack membership or an invalid bottom-base lookup emits `force_full=true`: a
// blank diff base must never silently narrow coverage to only the top layer.
//
// A stacked PR's base is another PR's head branch, so a PR with a non-default base that is in no
// stack yet is waiting on registration (`gh stack submit` opens the PRs, then links them); it is
// retried briefly rather than run as a stack of one.
import { appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** The label that makes a lower layer run CI anyway (Aaron merges up to it when the top is red). */
export const FORCE_LABEL = "ci-now";

/** Whether `number` should run, given the repository's stacks (`GET /stacks`) and its own base. */
export function decide({ number, baseIsDefault, stacks, labels = [] }) {
  const stack = stacks.find((s) => (s.pull_requests ?? []).some((p) => p.number === number));
  if (!stack) {
    return baseIsDefault
      ? { run: true, why: "not in a stack" }
      : { run: null, why: "based on another branch but not registered yet" };
  }
  const layers = stack.pull_requests;
  const top = layers[layers.length - 1].number;
  // Bottom to top; the diff base is read from the lowest one still open.
  const below = layers.map((p) => p.number);
  if (top === number) return { run: true, layers: below, why: `top of stack #${stack.number}` };
  if (labels.includes(FORCE_LABEL))
    return { run: true, layers: below, why: `labelled \`${FORCE_LABEL}\`` };
  return {
    run: false,
    layers: below,
    why: `layer ${layers.findIndex((p) => p.number === number) + 1} of ${layers.length} in stack #${stack.number}; CI runs on #${top}`,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetchStacks()` returns the array from `GET /repos/{repo}/stacks` and `fetchLabels()` the
 * pull request's label names, read live: labelling a skipped layer and re-running its jobs works
 * because the event payload's labels are never consulted. Both are injected for the test.
 */
export async function gate(env, fetchStacks, wait = sleep, fetchLabels = async () => []) {
  if (env.GITHUB_EVENT_NAME !== "pull_request") return { run: true, why: "not a pull request" };
  const number = Number(env.PR_NUMBER);
  const baseIsDefault = env.PR_BASE_REF === env.DEFAULT_BRANCH;
  let last = { run: true, why: "no answer" };
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const stacks = await fetchStacks();
      last = decide({ number, baseIsDefault, stacks, labels: await fetchLabels() });
    } catch (error) {
      return { run: true, forceFull: true, why: `stacks API unavailable (${error.message})` };
    }
    if (last.run !== null) return last;
    await wait(10_000);
  }
  return { run: true, forceFull: true, why: `${last.why}; ran it rather than wait` };
}

/** An uncertain stack must run all checks, never just the last layer's diff. */
export async function resolveDiffScope(result, env, pull) {
  let diffBase = "";
  let forceFull = result.forceFull === true;
  if (result.run && result.layers?.length) {
    try {
      let base;
      for (const number of result.layers) {
        const layer = await pull(number);
        // A merged layer's base is the default branch before the stack landed: skip to the
        // lowest layer still to merge.
        if (layer.merged || layer.merged_at) continue;
        base = layer.base;
        break;
      }
      if (!/^[0-9a-f]{40}$/.test(base?.sha ?? "") || base.ref !== env.DEFAULT_BRANCH) {
        throw new Error("the lowest open layer has no valid default-branch base");
      }
      diffBase = base.sha;
    } catch {
      forceFull = true;
    }
  }
  return { ...result, diffBase, forceFull };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token } = process.env;
  const api = async (pathname) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${pathname}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  const pull = async (number) => api(`pulls/${number}`);
  const result = await gate(
    process.env,
    () => api("stacks?per_page=100"),
    sleep,
    async () => (await api(`issues/${process.env.PR_NUMBER}/labels`)).map((l) => l.name),
  );
  const { diffBase, forceFull } = await resolveDiffScope(result, process.env, pull);
  const line = `CI ${result.run ? "runs" : "is skipped"}: ${result.why}.${forceFull ? " Stack scope is uncertain; change detection runs everything." : ""}${diffBase ? ` Diffs against the stack's base ${diffBase.slice(0, 9)}.` : ""}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `run=${result.run}\ndiff_base=${diffBase}\nforce_full=${forceFull}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  }
}
