#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export const CI_JOBS = [
  "repo-safeguards",
  "unit-tests",
  "unit-tests-docs",
  "build",
  "playwright",
  "fast-lane",
  "visual-plan",
  "visual",
  "visual-publish",
  "visual-report",
  "changes",
  "real-postgres",
  "coverage-floors",
  "visual-flakes",
];

const SHA = /^[0-9a-f]{40}$/i;
const isSha = (value) => typeof value === "string" && SHA.test(value);

/** Refuse a green verdict when the run no longer names the PR's live candidate. */
export function ciCandidateProblems({
  event,
  ref = "",
  sha = "",
  prNumber = "",
  headSha = "",
  baseSha = "",
  currentPullRequest = null,
  candidateCommits = null,
}) {
  const problems = [];
  if (!isSha(sha)) problems.push("CI candidate SHA is missing or invalid");
  if (["push", "workflow_dispatch"].includes(event)) {
    if (ref !== "refs/heads/main") problems.push("main CI run is not on refs/heads/main");
    return problems;
  }
  if (event !== "pull_request") return ["unsupported CI event"];
  if (!/^\d+$/.test(prNumber)) problems.push("pull request number is missing or invalid");
  if (ref !== `refs/pull/${prNumber}/merge`)
    problems.push(`CI ref does not identify PR #${prNumber}'s merge candidate`);
  if (!isSha(headSha)) problems.push("PR head SHA from this event is missing or invalid");
  if (!isSha(baseSha)) problems.push("PR base SHA from this event is missing or invalid");
  if (!currentPullRequest) {
    problems.push("current pull request evidence is unavailable");
    return problems;
  }
  if (currentPullRequest.head?.sha !== headSha)
    problems.push("PR head changed after this CI run started");
  if (currentPullRequest.base?.sha !== baseSha)
    problems.push("PR base changed after this CI run started");
  if (!isSha(currentPullRequest.merge_commit_sha))
    problems.push("current PR merge candidate SHA is missing or invalid");
  else if (currentPullRequest.merge_commit_sha !== sha) {
    const runCommit = commitTreeAndParents(candidateCommits?.run, sha, headSha);
    const currentCommit = commitTreeAndParents(
      candidateCommits?.current,
      currentPullRequest.merge_commit_sha,
      headSha,
    );
    if (!runCommit || !currentCommit) {
      problems.push("PR merge candidate tree/parent evidence is missing or invalid");
    } else if (
      runCommit.tree !== currentCommit.tree ||
      runCommit.parents.length !== currentCommit.parents.length ||
      runCommit.parents.some((parent, index) => parent !== currentCommit.parents[index])
    ) {
      problems.push("PR merge candidate tree or parents changed after this CI run started");
    }
  }
  return problems;
}

/** The only merge-commit fields used for equivalence; reject partial or malformed REST data. */
function commitTreeAndParents(commit, expectedSha, expectedHeadSha) {
  if (commit?.sha !== expectedSha || !isSha(commit.sha)) return null;
  const tree = commit.tree?.sha;
  const parents = commit.parents;
  if (
    !isSha(tree) ||
    !Array.isArray(parents) ||
    parents.length !== 2 ||
    !parents.every((parent) => isSha(parent?.sha))
  )
    return null;
  const orderedParents = parents.map(({ sha }) => sha.toLowerCase());
  if (!isSha(expectedHeadSha) || orderedParents[1] !== expectedHeadSha.toLowerCase()) return null;
  return { tree: tree.toLowerCase(), parents: orderedParents };
}

function readCurrentPullRequest(env, timeoutMs = SUBPROCESS_TIMEOUTS.ghCli) {
  if (env.GITHUB_EVENT_NAME !== "pull_request") return null;
  if (!/^\d+$/.test(env.PR_NUMBER ?? "")) return null;
  try {
    return JSON.parse(
      readBounded("gh", ["api", `repos/${env.GITHUB_REPOSITORY}/pulls/${env.PR_NUMBER}`], {
        encoding: "utf8",
        timeoutMs,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

/** Read a commit object only for the changed-SHA case, through the bounded GitHub CLI path. */
function readCandidateCommit(repository, sha) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") || !isSha(sha)) return null;
  try {
    return JSON.parse(
      readBounded("gh", ["api", `repos/${repository}/git/commits/${sha}`], {
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.ghHookRead,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

/** Recheck after three short metadata reads, which fit inside ci-result's five-minute job. */
function readCandidateCommits(env, currentPullRequest) {
  const currentSha = currentPullRequest?.merge_commit_sha ?? "";
  const prNumber = env.PR_NUMBER ?? "";
  if (
    env.GITHUB_EVENT_NAME !== "pull_request" ||
    currentSha === env.GITHUB_SHA ||
    !/^\d+$/.test(prNumber) ||
    env.GITHUB_REF !== `refs/pull/${prNumber}/merge` ||
    !isSha(env.GITHUB_SHA) ||
    !isSha(env.PR_HEAD_SHA) ||
    !isSha(env.PR_BASE_SHA) ||
    currentPullRequest?.head?.sha !== env.PR_HEAD_SHA ||
    currentPullRequest?.base?.sha !== env.PR_BASE_SHA ||
    !isSha(currentSha)
  )
    return null;
  const run = readCandidateCommit(env.GITHUB_REPOSITORY, env.GITHUB_SHA);
  const current = readCandidateCommit(env.GITHUB_REPOSITORY, currentSha);
  if (!run || !current) return null;
  const latestPullRequest = readCurrentPullRequest(env, SUBPROCESS_TIMEOUTS.ghHookRead);
  if (
    latestPullRequest?.head?.sha !== currentPullRequest.head.sha ||
    latestPullRequest?.base?.sha !== currentPullRequest.base.sha ||
    latestPullRequest?.merge_commit_sha !== currentSha
  )
    return null;
  return { run, current };
}

/** The aggregate is green only when every expected result exists and required lanes ran. */
export function ciMergeVerdict(
  needs,
  { code, db, safety = "true", browser = "true", event, ref = "", fork = false },
) {
  const problems = [];
  if (!["true", "false"].includes(code) || !["true", "false"].includes(db))
    problems.push("change detection outputs are missing or invalid");
  if (!["pull_request", "push", "workflow_dispatch"].includes(event))
    problems.push("unsupported CI event");
  const required = new Set([
    "changes",
    "repo-safeguards",
    code === "true" ? "unit-tests" : "unit-tests-docs",
  ]);
  // `browser` is false only for a pull request that changed unit-test files alone (ci.yml's
  // `changes` job); a missing or malformed value fails closed, like `safety`.
  if (code === "true" && browser !== "false")
    for (const id of ["build", "playwright", "visual-plan", "visual", "visual-report"])
      required.add(id);
  // Only a pull request that touched nothing the safety-file floors measure may skip them
  // (ci.yml's `safety` output, scripts/coverage-relevant.mjs); anything else fails closed.
  if (code === "true" && safety !== "false") required.add("coverage-floors");
  if (code === "true" && browser !== "false" && !fork) required.add("visual-publish");
  if (db === "true") required.add("real-postgres");
  if (code === "true" && ["push", "workflow_dispatch"].includes(event) && ref === "refs/heads/main")
    required.add("visual-flakes");
  for (const id of CI_JOBS) {
    const result = needs?.[id]?.result;
    if (result !== "success" && (result !== "skipped" || required.has(id)))
      problems.push(`${id}: ${result ?? "missing"}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const needs = JSON.parse(process.env.CI_NEEDS ?? "null");
    const env = process.env;
    const currentPullRequest = readCurrentPullRequest(env);
    const candidateProblems = ciCandidateProblems({
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
      sha: env.GITHUB_SHA,
      prNumber: env.PR_NUMBER,
      headSha: env.PR_HEAD_SHA,
      baseSha: env.PR_BASE_SHA,
      currentPullRequest,
      candidateCommits: readCandidateCommits(env, currentPullRequest),
    });
    const problems = ciMergeVerdict(needs, {
      code: needs?.changes?.outputs?.code,
      db: needs?.changes?.outputs?.db,
      safety: needs?.changes?.outputs?.safety,
      browser: needs?.changes?.outputs?.browser,
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
      fork: env.PR_IS_FORK === "true",
    });
    problems.push(...candidateProblems);
    if (problems.length) {
      console.error(`CI result: ${problems.join(", ")}`);
      process.exitCode = 1;
    } else console.log("CI result: all required jobs passed");
  } catch (error) {
    console.error(`CI result: invalid evidence: ${error.message}`);
    process.exitCode = 1;
  }
}
