#!/usr/bin/env node
// Names reg-suit's two snapshot keys outright, rather than letting a plugin
// infer them from the shape of the local git graph.
//
// reg-suit needs two keys per run: the **actual** key it publishes this
// commit's screenshots under, and the **expected** key it fetches the baseline
// from. Until 2026-08-23 both came from `reg-keygen-git-hash-plugin`, which
// walks the local graph with no network call and no configuration
// (`CommitExplorer.getBaseCommitHash()`): it triangulates merge-bases against
// every other branch in the working copy and takes the newest commit that is on
// this branch and on some other one. That inference is correct — for a stacked
// pull request it lands on the layer below's head, which is exactly what makes
// a stack's diffs readable — but it is only reproducible if you can predict
// which refs happen to be in the checkout, which is why `visual-report` grew
// three steps whose only job was to arrange the graph the way the plugin wanted
// (ADR 20260821-stacked-pull-requests). This computes the same two answers
// directly, from the CI event, so the key a run uses is a stated fact rather
// than a property of a workspace.
//
// **The key strings must not change.** Every baseline in the S3 bucket is
// keyed by full 40-character commit sha — that is what the old plugin's
// `git rev-parse` returned for both keys — so anything shorter or prettier here
// makes the whole published history unreachable, and the first symptom is a
// push to `main` reporting every surface as new. Both keys stay full shas.
//
// Consumed by `scripts/visual-compare.mjs` (which puts them in the environment
// `regconfig.json` reads) and by the `visual-report` job in
// `.github/workflows/ci.yml` (which also needs the expected key *before* the
// compare, to wait for a stacked layer's baseline — `scripts/wait-for-baseline.mjs`).
import { appendFileSync } from "node:fs";
import process from "node:process";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** A reg-suit key is a full commit sha and nothing else. See the header. */
export const COMMIT_SHA = /^[0-9a-f]{40}$/;

// Conservative git ref shape. `PR_BASE_REF` arrives from the GitHub event
// payload, so it is checked before it reaches an argv even though every `git`
// call here goes through `readBounded` (execFile, no shell) — a ref that cannot
// be a ref is a bug worth naming rather than a merge-base that quietly misses.
const REF_NAME = /^[\w][\w./-]*$/;

/** `git` reader for the real repository: one bounded, shell-free call per invocation. */
export function gitReader(cwd = process.cwd()) {
  return (args) =>
    readBounded("git", args, {
      cwd,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function attempt(git, args) {
  try {
    const value = git(args).trim();
    return COMMIT_SHA.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Resolves `{ actualKey, expectedKey, stacked, source }` for one reg-suit run.
 *
 * `expectedKey` is deliberately allowed to come back null — a first commit, or
 * a pull request whose base branch has been deleted under it. reg-suit treats a
 * missing expected key exactly as it treated a failed inference: it warns
 * "Failed to detect the previous snapshot key", compares nothing, and the
 * sticky summary comment says so in words. A *missing actual key* is a
 * different animal and the caller must refuse to run on it; see
 * `scripts/visual-compare.mjs`.
 *
 * @param git a reader taking an argv array and returning stdout, throwing on failure
 */
export function resolveRegSuitKeys({ env = process.env, git }) {
  const event = env.GITHUB_EVENT_NAME || "local";
  const defaultBranch = env.DEFAULT_BRANCH || "main";
  const actualKey = attempt(git, ["rev-parse", "HEAD"]);

  // A tripwire, not a fallback. This job checks out `pull_request.head.sha`
  // deliberately (the merge commit is ephemeral and is never a reg-suit key),
  // and if that ever regresses to a default checkout the keys would be computed
  // from a commit that exists only inside this run — published under a sha no
  // later run can ask for. Fail on the mismatch instead of publishing it.
  const declaredHead = env.PR_HEAD_SHA;
  if (declaredHead && actualKey && declaredHead !== actualKey) {
    throw new Error(
      `reg-suit-keys: HEAD is ${actualKey} but the event says the pull request head is ${declaredHead}. ` +
        "The visual-report job must check out the head commit itself; a merge commit is never a reg-suit key.",
    );
  }

  const parent = () => attempt(git, ["rev-parse", "HEAD^"]);
  let expectedKey = null;
  let source = "";

  if (event === "pull_request") {
    const baseRef = env.PR_BASE_REF;
    if (baseRef && !REF_NAME.test(baseRef)) {
      throw new Error(`reg-suit-keys: refusing an implausible base ref "${baseRef}".`);
    }
    // The fork point of this branch from its base — the same commit the graph
    // walk resolved, and for a stacked layer that is the layer below's head.
    if (baseRef) {
      expectedKey = attempt(git, ["merge-base", `origin/${baseRef}`, "HEAD"]);
      if (expectedKey) source = `merge-base with origin/${baseRef}`;
    }
    // The base branch can vanish mid-run: an auto-merged layer deletes its head
    // branch, and this job runs 6-10 minutes after the run starts. The event
    // payload still remembers where it pointed.
    if (!expectedKey && COMMIT_SHA.test(env.PR_BASE_SHA ?? "")) {
      expectedKey = attempt(git, ["merge-base", env.PR_BASE_SHA, "HEAD"]) ?? env.PR_BASE_SHA;
      source = "merge-base with the event's base sha (the base branch is gone)";
    }
  } else if (event === "push") {
    // A push to `main`: the baseline is the commit before this one, which is
    // what the deleted `reg-suit-baseline-parent` branch used to spell out for
    // the graph walk.
    expectedKey = parent();
    source = "the previous commit";
  } else {
    // A local `pnpm visual`. On a topic branch the baseline is the fork point
    // from the default branch — the same answer the graph walk gave, so a local
    // run and a CI run on the same commit read the same baseline. On the
    // default branch itself it is the previous commit.
    const onDefault = attempt(git, ["rev-parse", defaultBranch]) === actualKey;
    if (!onDefault) {
      expectedKey = attempt(git, ["merge-base", `origin/${defaultBranch}`, "HEAD"]);
      if (expectedKey) source = `merge-base with origin/${defaultBranch}`;
    }
    if (!expectedKey) {
      expectedKey = parent();
      source = "the previous commit";
    }
  }

  // Comparing a commit against itself resolves a baseline that is this run's own
  // upload — reg-suit would report every surface as passed, having compared each
  // one to a copy of itself. A branch with no commits of its own does this.
  if (expectedKey && expectedKey === actualKey) {
    expectedKey = parent();
    source = "the previous commit (the base resolved to this commit itself)";
  }

  const baseRef = env.PR_BASE_REF;
  const stacked = event === "pull_request" && !!baseRef && baseRef !== defaultBranch;

  return {
    actualKey,
    expectedKey,
    stacked,
    source: expectedKey ? source : "nothing to compare against",
  };
}

function writeLines(file, lines) {
  if (!file) return;
  appendFileSync(file, `${lines.join("\n")}\n`);
}

function main(argv) {
  const keys = resolveRegSuitKeys({ git: gitReader() });
  const { actualKey, expectedKey, stacked, source } = keys;

  console.log(`reg-suit-keys: actual   ${actualKey ?? "(unresolved)"}`);
  console.log(`reg-suit-keys: expected ${expectedKey ?? "(none)"} — ${source}`);
  if (stacked) {
    console.log(
      "reg-suit-keys: this pull request is stacked on another branch, so its baseline is the layer below's head.",
    );
  }

  if (argv.includes("--github-env")) {
    // Empty rather than absent for an unresolved expected key: `regconfig.json`
    // interpolates `${REG_EXPECTED_KEY}`, and reg-suit's substitution writes the
    // literal string "undefined" for a variable that is not set at all.
    writeLines(process.env.GITHUB_ENV, [
      `REG_ACTUAL_KEY=${actualKey ?? ""}`,
      `REG_EXPECTED_KEY=${expectedKey ?? ""}`,
    ]);
    writeLines(process.env.GITHUB_OUTPUT, [
      `actual=${actualKey ?? ""}`,
      `expected=${expectedKey ?? ""}`,
      `stacked=${stacked}`,
    ]);
    return;
  }
  console.log(JSON.stringify(keys, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
