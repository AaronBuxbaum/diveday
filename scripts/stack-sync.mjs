#!/usr/bin/env node
// `pnpm stack:sync`: merge the layer below into this one, so `main` reaches the stack bottom up.
//
// A stacked layer falls behind twice over: behind the layer below, and through it behind `main`.
// Threads brought it forward by hand, from memory of which branch was below, and the order went
// wrong often enough to cost a red run (findings 2026-10-22: the same failure repeats up a stack
// until each layer merges the fix from below). The chain is in the open pull requests: each
// layer's base is the head branch of the one below, and the bottom's base is `main`.
//
//   pnpm stack:sync            merge this layer's base (origin/main for the bottom) into it
//   pnpm stack:sync --chain    the same for every layer, bottom first, in local worktrees only
//   pnpm stack:sync --plan     print the chain and what would merge, change nothing
//
// It merges and never pushes: a push is the thread's own, one layer's CI at a time (the
// stacked-prs skill). It never rebases,
// never force-pushes, never switches a checkout's branch and never stashes. It stops on a
// conflict with the merge left open and the files named, and refuses a worktree with
// uncommitted changes, a merge already in progress, or a branch behind its own remote.
//
// `--chain` acts only in a worktree that already has the layer's branch checked out and passes
// the same checks; it stops at the first layer it cannot sync and prints what is left. Other
// sessions share this checkout (AGENTS.md, *Parallel work*): another thread's worktree is synced
// only when this is asked for by name.
//
// The open pull requests come from GitHub's REST API (`tracker().listPulls()`); without it the
// layer below is the branch's recorded verification base, else origin/main.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { tracker } from "./tracker.mjs";

const MAIN = "main";
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

/**
 * The open chain through `branch`, from `pulls` (`{ number, headRefName, baseRefName }`):
 * `{ layers, index, forks }`, `layers` bottom first, each `{ branch, number, base }`, `index`
 * the position of `branch` (-1 when it has no open pull request), and `forks` the head branches
 * that stack on the same layer as another (the walk up stops there).
 */
export function chainFor(pulls, branch) {
  const byHead = new Map(pulls.map((pull) => [pull.headRefName, pull]));
  const own = byHead.get(branch);
  if (!own) return { layers: [], index: -1, forks: [] };
  const layer = (pull) => ({
    branch: pull.headRefName,
    number: pull.number,
    base: pull.baseRefName,
  });
  const below = [];
  const seen = new Set([branch]);
  for (let pull = own; pull.baseRefName !== MAIN; ) {
    const next = byHead.get(pull.baseRefName);
    if (!next || seen.has(next.headRefName)) break;
    seen.add(next.headRefName);
    below.unshift(layer(next));
    pull = next;
  }
  const above = [];
  const forks = [];
  for (let top = branch; ; ) {
    const children = pulls.filter(
      (pull) => pull.baseRefName === top && !seen.has(pull.headRefName),
    );
    if (children.length !== 1) {
      forks.push(...children.map((pull) => pull.headRefName));
      break;
    }
    seen.add(children[0].headRefName);
    above.push(layer(children[0]));
    top = children[0].headRefName;
  }
  return { layers: [...below, layer(own), ...above], index: below.length, forks };
}

/** `git worktree list --porcelain` → Map of branch name → worktree path. */
export function worktreesByBranch(porcelain) {
  const found = new Map();
  let at = null;
  for (const line of (porcelain ?? "").split("\n")) {
    if (line.startsWith("worktree ")) at = line.slice("worktree ".length);
    else if (line.startsWith("branch refs/heads/") && at) {
      found.set(line.slice("branch refs/heads/".length), at);
    }
  }
  return found;
}

/**
 * Merge `target` into the branch checked out at `dir`. `git(dir, args)` → `{ status, stdout }`.
 * Returns `{ state, lines }`: `state` is "merged", "current" (nothing to merge), "refused" or
 * "conflict"; `lines` say what happened and what to do. With `plan`, nothing is changed.
 */
export function syncLayer({ git, dir, branch, target, plan = false }) {
  const out = (args) => {
    const result = git(dir, args);
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const where = `${branch} (${dir})`;
  if (out(["rev-parse", "--verify", "--quiet", `${target}^{commit}`]) === null) {
    return {
      state: "refused",
      lines: [`${where}: ${target} does not exist here; fetch it first.`],
    };
  }
  if ((out(["status", "--porcelain", "--untracked-files=no"]) ?? "x") !== "") {
    return {
      state: "refused",
      lines: [
        `${where}: uncommitted changes. Commit them first (never a bare \`git stash\`; AGENTS.md).`,
      ],
    };
  }
  if (out(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]) !== null) {
    return {
      state: "refused",
      lines: [`${where}: a merge is already in progress. Finish it or \`git merge --abort\`.`],
    };
  }
  const remote = `origin/${branch}`;
  if (
    out(["rev-parse", "--verify", "--quiet", remote]) !== null &&
    out(["merge-base", "--is-ancestor", remote, "HEAD"]) === null
  ) {
    return {
      state: "refused",
      lines: [
        `${where}: behind ${remote}, which has commits this checkout lacks. Merge it first (\`git merge --ff-only ${remote}\`) so the two never diverge.`,
      ],
    };
  }
  if (out(["merge-base", "--is-ancestor", target, "HEAD"]) !== null) {
    return { state: "current", lines: [`${where}: already contains ${target}.`] };
  }
  const behind = out(["rev-list", "--count", `HEAD..${target}`]) ?? "?";
  if (plan) {
    return {
      state: "current",
      lines: [`${where}: would merge ${behind} commit(s) from ${target}.`],
    };
  }
  const merged = git(dir, ["merge", "--no-edit", target]);
  if (merged.status !== 0) {
    const files = (out(["diff", "--name-only", "--diff-filter=U"]) ?? "")
      .split("\n")
      .filter(Boolean);
    return {
      state: "conflict",
      lines: [
        `${where}: merging ${target} stopped on conflicts${files.length ? ` in ${files.join(", ")}` : ""}.`,
        "  Resolve them, `git add` each file and `git commit --no-edit`; or `git merge --abort` to leave the branch as it was.",
        "  A conflict in a generated file is settled by `pnpm regen`, not by hand.",
      ],
    };
  }
  return {
    state: "merged",
    lines: [`${where}: merged ${behind} commit(s) from ${target}.`],
  };
}

/** What a synced layer does next, never run from here: regen, then the push. */
export function nextSteps(dir) {
  return `cd ${dir} && pnpm regen (commit what it changed) && git push`;
}

/**
 * The whole run, every effect injected: `git(dir, args)`, `pulls()`, `cwd`, `log`. Returns the
 * exit code: 0 when every layer it was asked to sync is synced, 1 otherwise.
 */
export function stackSync({ git, pulls, cwd, args = [], log = console.log }) {
  const chainMode = args.includes("--chain");
  const plan = args.includes("--plan");
  const read = (dir, gitArgs) => {
    const result = git(dir, gitArgs);
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const branch = read(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") {
    log("stack:sync: HEAD is not on a branch; check out the layer's branch first.");
    return 1;
  }
  let chain;
  try {
    chain = chainFor(pulls(), branch);
  } catch (error) {
    log(
      `stack:sync: could not list the open pull requests (${String(error.message).split("\n")[0]}).`,
    );
    chain = { layers: [], index: -1, forks: [] };
  }
  if (chain.index === -1) {
    const recorded = read(cwd, ["config", "--get", `branch.${branch}.divedayBase`]);
    const base = recorded && SAFE_REF.test(recorded) ? recorded.replace(/^origin\//, "") : MAIN;
    log(
      `stack:sync: ${branch} has no open pull request here; its layer below is taken as ${base}.`,
    );
    chain = { layers: [{ branch, number: null, base }], index: 0, forks: [] };
  }
  const { layers, index, forks } = chain;
  log("Stack, bottom first:");
  layers.forEach((layer, i) => {
    const pr = layer.number ? `#${layer.number} ` : "";
    log(`  ${i + 1}. ${pr}${layer.branch} → ${layer.base}${i === index ? "  <- HEAD" : ""}`);
  });
  if (forks.length > 0) log(`  forks above (not walked): ${forks.join(", ")}`);
  if (layers.some((layer) => !SAFE_REF.test(layer.branch) || !SAFE_REF.test(layer.base))) {
    log("stack:sync: a branch name in the chain is not a plain ref; sync it by hand.");
    return 1;
  }

  const refs = [
    ...new Set([
      ...layers.map((layer) => layer.base),
      ...layers.filter((layer) => layer.number).map((layer) => layer.branch),
    ]),
  ];
  const fetched = git(cwd, [
    "fetch",
    "origin",
    ...refs.map((ref) => `+refs/heads/${ref}:refs/remotes/origin/${ref}`),
  ]);
  if (fetched.status !== 0)
    log("stack:sync: the fetch failed; merging the refs as of the last fetch.");

  const worktrees = worktreesByBranch(read(cwd, ["worktree", "list", "--porcelain"]));
  const todo = chainMode ? layers.map((_, i) => i) : [index];
  const done = [];
  for (const i of todo) {
    const layer = layers[i];
    const dir = i === index ? cwd : worktrees.get(layer.branch);
    if (!dir) {
      log(
        `stack:sync: no local worktree has ${layer.branch} checked out; its owner runs \`pnpm stack:sync\` there. Stopping.`,
      );
      break;
    }
    // A layer synced in this run is merged up from its local branch, not from a stale remote.
    const below = i > 0 ? layers[i - 1].branch : null;
    const target = below && done.includes(below) && !plan ? below : `origin/${layer.base}`;
    if (!chainMode && i > 0) {
      const lower = `origin/${layer.base}`;
      if (read(cwd, ["merge-base", "--is-ancestor", `origin/${MAIN}`, lower]) === null) {
        log(
          `stack:sync: ${layer.base}${layers[i - 1].number ? ` (#${layers[i - 1].number})` : ""} is itself behind main. It syncs first (\`pnpm stack:sync\` in its worktree, by its owner); merging it now brings only what it has.`,
        );
      }
    }
    const result = syncLayer({ git, dir, branch: layer.branch, target, plan });
    for (const line of result.lines) log(line);
    if (result.state === "refused" || result.state === "conflict") return 1;
    done.push(layer.branch);
  }
  if (plan) return 0;

  const synced = done.map((name) => layers.find((layer) => layer.branch === name));
  if (synced.length > 0) {
    log("Next, bottom first, one layer's CI at a time (nothing was pushed):");
    for (const layer of synced) {
      const dir = layer.branch === branch ? cwd : worktrees.get(layer.branch);
      log(`  ${layer.branch}: ${nextSteps(dir)}`);
    }
  }
  const last = layers.indexOf(synced.at(-1) ?? layers[index]);
  const rest = layers.slice(last + 1);
  if (rest.length > 0) {
    log("Then each layer above merges the one below, after that layer's push:");
    for (const layer of rest) {
      const dir = worktrees.get(layer.branch);
      log(`  ${layer.branch}: ${dir ? `cd ${dir} && ` : "in its worktree: "}pnpm stack:sync`);
    }
  }
  return done.length === todo.length ? 0 : 1;
}

function gitIn(dir, args) {
  const fetch = args[0] === "fetch";
  const result = runBounded("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: fetch ? SUBPROCESS_TIMEOUTS.gitFetch : SUBPROCESS_TIMEOUTS.git,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = stackSync({
    git: gitIn,
    pulls: () => tracker().listPulls(),
    cwd: process.cwd(),
    args: process.argv.slice(2),
  });
}
