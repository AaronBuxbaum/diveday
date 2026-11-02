#!/usr/bin/env node
// Warnings about a stack that is losing work (issue #3646). Advice only: this never refuses,
// never exits non-zero and is wired into no check, so stacking stays fast (Aaron, 2026-11-02).
//
// On 2026-11-01 five pull requests (#3579 to #3583) merged into a side branch that was then moved
// and merged as #3587, and none of their commits reached main. Nothing noticed, because each merge
// was green on its own. Three signals, read from git and the pull-request list:
//
//   1. A merged pull request whose base was not main and whose merge commit is not in main, unless
//      its base branch's own pull request landed with that merge inside its final head.
//   2. Two open pull requests on one base that is not main: a fork in the stack.
//   3. An open pull request whose head does not contain its base branch's tip: the base moved.
//
//   node scripts/stack-warnings.mjs          print the warnings (nothing when there are none)
//   node scripts/stack-map.mjs --warnings    the same, after the stack
//
// The pull-request list needs the tracker (`scripts/tracker.mjs`, REST); without it this prints
// nothing, because a warning it cannot ground is worse than silence.
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { tracker } from "./tracker.mjs";

/** `git` with a constant argument array; trimmed stdout, or null on a non-zero exit. */
function gitReader(cwd) {
  return (args) => {
    try {
      return readBounded("git", args, {
        cwd,
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
}

const MAIN = "main";
const ORIGIN_MAIN = "origin/main";
/** Merged pull requests read per run; older ones landed or were noticed long ago. */
const MERGED_LIMIT = 100;
const MAX_DEPTH = 8;

/**
 * `merged` and `open` are pull requests `{ number, headRefName, baseRefName, mergedAt,
 * mergeCommitSha, headSha }`. `git` answers `isAncestor(a, b)` (true, false, or null when git has
 * no object to answer from), `tip(branch)` (the remote tip sha, or null) and `contains(branch,
 * sha)`. Returns an array of one-sentence warnings.
 */
export function stackWarnings({ merged, open, git }) {
  const warnings = [];
  const mergedByHead = new Map(merged.map((pull) => [pull.headRefName, pull]));

  // 1. Merged into something other than main, and not in main. Returns null when git cannot say.
  const landed = (pull, depth = 0) => {
    if (!pull.mergeCommitSha) return null;
    const inMain = git.isAncestor(pull.mergeCommitSha, ORIGIN_MAIN);
    if (inMain === null) return null;
    if (inMain || pull.baseRefName === MAIN) return { ok: true };
    const owner = mergedByHead.get(pull.baseRefName);
    if (!owner || depth >= MAX_DEPTH) {
      return { ok: false, why: `${pull.baseRefName} has no merged pull request of its own` };
    }
    const ownerLanded = landed(owner, depth + 1);
    if (ownerLanded === null || !ownerLanded.ok) return ownerLanded;
    const inside = owner.headSha ? git.isAncestor(pull.mergeCommitSha, owner.headSha) : null;
    if (inside === null) return null;
    if (inside) return { ok: true };
    return {
      ok: false,
      why: `#${owner.number} landed ${pull.baseRefName} but this merge commit is not in its final head, so the branch moved after the merge`,
    };
  };

  for (const pull of merged.slice(0, MERGED_LIMIT)) {
    if (!pull.mergedAt || pull.baseRefName === MAIN) continue;
    const result = landed(pull);
    if (result && !result.ok) {
      warnings.push(
        `#${pull.number} merged into ${pull.baseRefName}, not main, and its merge commit is not in ${ORIGIN_MAIN} (${result.why}). Check that the work reached main.`,
      );
    }
  }

  // 2. Two open pull requests on one base that is not main.
  const byBase = new Map();
  for (const pull of open) {
    if (pull.baseRefName === MAIN) continue;
    byBase.set(pull.baseRefName, [...(byBase.get(pull.baseRefName) ?? []), pull]);
  }
  for (const [base, pulls] of byBase) {
    if (pulls.length > 1) {
      warnings.push(
        `${pulls.map((pull) => `#${pull.number}`).join(", ")} both stack on ${base}: the stack forks there, and whichever merges second will conflict with the first.`,
      );
    }
  }

  // 3. A child whose base branch moved on without it.
  for (const pull of open) {
    if (pull.baseRefName === MAIN) continue;
    const tip = git.tip(pull.baseRefName);
    if (!tip) continue;
    if (!git.contains(pull.headRefName, tip)) {
      warnings.push(
        `#${pull.number} (${pull.headRefName}) does not contain ${pull.baseRefName}'s tip: the branch below moved. Run pnpm stack:sync in that worktree before pushing.`,
      );
    }
  }
  return warnings;
}

export function renderWarnings(warnings) {
  if (warnings.length === 0) return "";
  return `${[
    ...warnings.map((warning) => `warning: ${warning}`),
    "These are advice, not a gate: nothing here refuses a push or fails a check.",
  ].join("\n")}\n`;
}

/**
 * The `git` that `stackWarnings` asks, over `read(args)` (trimmed stdout, or null on failure).
 * `isAncestor(a, b)`: a commit this clone does not have cannot be an ancestor of one it does, so
 * a missing `a` is `false`; this is the case that matters, since a merge into a side branch that
 * was then moved is reachable from no fetched ref (#3579's merge commit was in no clone). A
 * missing `b` leaves nothing to compare against, so that is `null`.
 */
export function gitFor(read) {
  const has = (sha) => read(["cat-file", "-e", `${sha}^{commit}`]) !== null;
  return {
    isAncestor: (a, b) => {
      if (!has(b)) return null;
      if (!has(a)) return false;
      return read(["merge-base", "--is-ancestor", a, b]) !== null;
    },
    tip: (branch) => read(["rev-parse", "--verify", "--quiet", `origin/${branch}`]),
    contains: (branch, sha) =>
      read(["merge-base", "--is-ancestor", sha, `origin/${branch}`]) !== null,
  };
}

/** The real `git` and pull requests behind `stackWarnings`; null when either cannot be read. */
export function readWarnings(cwd = process.cwd()) {
  const read = gitReader(cwd);
  let github;
  try {
    github = tracker();
    const open = github.listPulls({ state: "open" });
    const closed = github.listPulls({ state: "closed", limit: MERGED_LIMIT });
    const git = gitFor(read);
    return stackWarnings({ merged: closed.filter((pull) => pull.mergedAt), open, git });
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(renderWarnings(readWarnings() ?? []));
}
