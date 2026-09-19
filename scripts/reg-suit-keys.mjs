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
// this branch and on some other one — which for a stacked pull request lands on
// the layer below's head. That was only reproducible if you could predict which
// refs happen to be in the checkout, which is why `visual-report` grew three
// steps whose only job was to arrange the graph the way the plugin wanted (ADR
// 20260821-stacked-pull-requests). This computes both answers directly, from
// the CI event, so the key a run uses is a stated fact rather than a property
// of a workspace.
//
// It also no longer agrees with the plugin about a stacked layer. Every pull
// request, stacked or not, is keyed to its fork point from the **default
// branch**, because a key on the layer below could only be satisfied by the
// layer below's own run — and the machinery that bought (a 20-minute poll, a
// 35-minute timeout, six jobs spent on every middle layer) cost more than the
// tidier diff was worth. `resolveRegSuitKeys` says the whole of it; ADR
// 20260919-stack-ci-cancels-superseded-layers is the decision.
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
// compare, to settle it on a commit that actually published —
// `scripts/wait-for-baseline.mjs`).
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
    for (const [name, ref] of [
      ["base ref", baseRef],
      ["default branch", defaultBranch],
    ]) {
      if (ref && !REF_NAME.test(ref)) {
        throw new Error(`reg-suit-keys: refusing an implausible ${name} "${ref}".`);
      }
    }
    // The fork point from the **default branch** — the last commit on `main`
    // this branch and `main` agree on — and not from `base.ref`, which for a
    // stacked layer is the layer below's branch.
    //
    // Keying a layer to the layer below reads better in principle: each diff
    // is that layer's own delta. It costs more than it is worth. The only run
    // that publishes the layer below's head is the layer below's own, so the
    // key named here could not be satisfied until that run finished, and every
    // consequence of that followed — a 20-minute S3 poll on the layer above, a
    // 35-minute job timeout to contain it, and a standing rule that a middle
    // layer must spend six jobs photographing surfaces nobody would look at,
    // purely so the layer above had something to compare against (ADR
    // 20260827-stack-ci-skips-the-middle-layers). A `main` commit is published
    // by `main`'s own run, long before any of this, so the key is always
    // already there and no layer waits on another.
    //
    // What changes in the output: the top layer's diff is now the whole
    // stack's visual delta rather than its own slice — which is what the top
    // layer's green is read as anyway, the closest thing a stack has to a
    // statement about the merged result. The bottom layer is unaffected: its
    // base *is* the default branch, so this resolves the same commit it always
    // did (ADR 20260919-stack-ci-cancels-superseded-layers).
    expectedKey = attempt(git, ["merge-base", `origin/${defaultBranch}`, "HEAD"]);
    if (expectedKey) source = `merge-base with origin/${defaultBranch}`;
    // Only for a pull request that targets the default branch directly. For a
    // stacked layer `PR_BASE_SHA` is the layer below's head, which is the one
    // answer this no longer wants; falling back to it would reintroduce the
    // dependency by the back door on the one path nobody watches.
    if (!expectedKey && baseRef === defaultBranch && COMMIT_SHA.test(env.PR_BASE_SHA ?? "")) {
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
      "reg-suit-keys: this pull request is stacked on another branch. Its baseline is still the " +
        "stack's fork point from the default branch, so this diff covers every layer at or below " +
        "this one — nothing here waits on the layer below.",
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
    ]);
    return;
  }
  console.log(JSON.stringify(keys, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
