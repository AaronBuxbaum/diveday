#!/usr/bin/env node
/**
 * Vercel's Ignored Build Step: did this commit change anything the deployed app
 * is made of?
 *
 * `vercel.json`'s `ignoreCommand` runs this at the top of every deployment,
 * before the install and before `scripts/vercel-build.mjs`. **Exit 1 builds;
 * exit 0 cancels** — Vercel's own polarity, backwards from every other script
 * in this directory, which is why the two exits below are named rather than
 * written as bare numbers.
 *
 * **Why it exists.** Vercel deploys every push to every branch, and about one
 * in ten of this repository's cannot move a pixel. Measured 2026-09-04 over the
 * whole history the clone had (2026-09-01..2026-09-04, 239 commits — this
 * repository moves at roughly 26 merges to `main` a day): **5 of the 50 most
 * recent first-parent commits on `main`, and 15 of the 170 branch commits in
 * the same window, changed only `docs/`, a Markdown file, `.claude/` or
 * `.github/`.** Each one paid for a full build — the migration guards, an
 * install, a Turbopack compile of the whole app, static generation against
 * Neon — to produce a byte-identical artifact.
 *
 * Measure it that way and not another: `git diff-tree` reports *nothing* for a
 * merge commit, and 56 of those 200 were merges, so the obvious one-liner
 * counts every merge as build-invisible and answers 30%. Compare trees
 * (`git diff <sha>^ <sha>`), which is also what this script does.
 *
 * `.github/workflows/ci.yml`'s `changes` job already refuses this work on the
 * CI side, for the same reason and against nearly the same path list; this is
 * the other half.
 *
 * **The path list is an allowlist of what to ignore**, exactly as CI's is, so a
 * new kind of file is code until someone says otherwise. `docs/`, `.claude/`
 * and `.github/` are the three trees `.vercelignore` already excludes from a
 * CLI-driven deploy, on a reading of the source tree recorded there ("every
 * reference to `docs/` under `src/` is a link inside a comment, not a read —
 * checked before excluding"). `.github/` is on this list and *not* on CI's,
 * deliberately and in the one direction that is safe: a workflow change is a
 * reason to re-run CI and can never change what a Vercel build produces.
 *
 * **Two dots, where CI uses three.** CI asks what a branch changed relative to
 * where it forked, and a two-dot range there would list everything main added
 * since as a deletion. This asks a different question — is the tree we would
 * deploy different from the tree that *is* deployed — and that is a comparison
 * of two trees, with no merge base in it. `VERCEL_GIT_PREVIOUS_SHA` is the last
 * **successful** deployment for this project and branch, so a run this script
 * cancels does not advance it: three docs commits in a row still diff against
 * the last commit that actually shipped, and the code push after them sees
 * everything since. That is the property a `HEAD^ HEAD` diff (Vercel's own
 * documented example) does not have, and it is the whole reason this is a
 * script rather than a one-liner in `vercel.json`.
 *
 * **Fail open, always**, like the CI job: every path out of here that cannot
 * answer confidently answers "build". A wasted build costs minutes; a wrong
 * skip leaves a deployment silently behind its branch, with a green check and
 * nothing to look at. `VERCEL_GIT_PREVIOUS_SHA` is empty on a branch's first
 * deployment and absent entirely outside a Vercel git deploy (the post-deploy
 * wizard's `vercel --prod --archive=tgz` uploads no `.git` at all), and both
 * build.
 */
import process from "node:process";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Vercel's polarity: exit 1 continues the build, exit 0 cancels it. */
export const EXIT_BUILD = 1;
export const EXIT_SKIP = 0;

/**
 * Everything a production build never opens, as `git diff` exclude pathspecs.
 * Anything not listed here is code, and code builds.
 */
export const BUILD_INVISIBLE_PATHSPECS = [
  ":(exclude)docs/**",
  ":(exclude)**/*.md",
  ":(exclude).claude/**",
  ":(exclude).github/**",
  ":(exclude)LICENSE",
];

/**
 * The git reads this needs, behind an interface so the decision below can be
 * tested without a repository.
 */
export const gitReader = {
  /** Is this commit object in the (shallow) clone Vercel handed us? */
  has(sha) {
    const result = runBounded("git", ["cat-file", "-e", `${sha}^{commit}`], {
      stdio: "ignore",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
    });
    return result.status === 0;
  },
  /**
   * Deepen the clone by one commit to reach `sha`. Vercel clones shallow, so
   * the previously deployed commit is routinely just past the boundary; without
   * this the script would fail open on nearly every run and buy nothing.
   */
  fetch(sha) {
    const result = runBounded("git", ["fetch", "--no-tags", "--depth=1", "origin", sha], {
      stdio: "ignore",
      timeoutMs: SUBPROCESS_TIMEOUTS.gitFetch,
    });
    return result.status === 0;
  },
  /** Files differing between two trees, minus the ones no build reads. */
  changedFiles(base, head) {
    const result = runBounded(
      "git",
      ["diff", "--name-only", base, head, "--", ".", ...BUILD_INVISIBLE_PATHSPECS],
      { encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.git },
    );
    if (result.status !== 0) return null;
    return result.stdout.split("\n").filter((line) => line !== "");
  },
};

/**
 * @returns {{ build: boolean, reason: string }} — `build: true` is also every
 * "cannot tell" answer.
 */
export function decideBuild({ previousSha, commitSha }, git = gitReader) {
  if (!previousSha) {
    return {
      build: true,
      reason:
        "no VERCEL_GIT_PREVIOUS_SHA — this branch has no successful deployment to compare against.",
    };
  }
  const head = commitSha || "HEAD";
  if (!git.has(previousSha) && !git.fetch(previousSha)) {
    return {
      build: true,
      reason: `the last deployed commit ${previousSha} is not in this clone and could not be fetched.`,
    };
  }
  if (!git.has(head)) {
    return { build: true, reason: `${head} is not a commit in this clone.` };
  }
  const changed = git.changedFiles(previousSha, head);
  if (changed === null) {
    return { build: true, reason: `git could not diff ${previousSha}..${head}.` };
  }
  if (changed.length > 0) {
    return {
      build: true,
      reason: `${changed.length} file(s) the build reads changed since ${previousSha.slice(0, 7)}: ${changed.slice(0, 10).join(", ")}${changed.length > 10 ? ", …" : ""}`,
    };
  }
  return {
    build: false,
    reason: `only docs, Markdown, \`.claude/\` or \`.github/\` changed since ${previousSha.slice(0, 7)} — the deployed artifact cannot differ.`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { build, reason } = decideBuild({
    previousSha: process.env.VERCEL_GIT_PREVIOUS_SHA,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  console.log(build ? `Building: ${reason}` : `Skipping the build: ${reason}`);
  process.exit(build ? EXIT_BUILD : EXIT_SKIP);
}
