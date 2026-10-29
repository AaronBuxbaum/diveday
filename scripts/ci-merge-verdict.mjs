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
  "visual-report",
  "changes",
  "real-postgres",
  "coverage-floors",
  "visual-flakes",
];

const SHA = /^[0-9a-f]{40}$/i;

/** Refuse a green verdict when the run no longer names the PR's live candidate. */
export function ciCandidateProblems({
  event,
  ref = "",
  sha = "",
  prNumber = "",
  headSha = "",
  baseSha = "",
  currentPullRequest = null,
}) {
  const problems = [];
  if (!SHA.test(sha)) problems.push("CI candidate SHA is missing or invalid");
  if (["push", "workflow_dispatch"].includes(event)) {
    if (ref !== "refs/heads/main") problems.push("main CI run is not on refs/heads/main");
    return problems;
  }
  if (event !== "pull_request") return ["unsupported CI event"];
  if (!/^\d+$/.test(prNumber)) problems.push("pull request number is missing or invalid");
  if (ref !== `refs/pull/${prNumber}/merge`)
    problems.push(`CI ref does not identify PR #${prNumber}'s merge candidate`);
  if (!SHA.test(headSha)) problems.push("PR head SHA from this event is missing or invalid");
  if (!SHA.test(baseSha)) problems.push("PR base SHA from this event is missing or invalid");
  if (!currentPullRequest) {
    problems.push("current pull request evidence is unavailable");
    return problems;
  }
  if (currentPullRequest.head?.sha !== headSha)
    problems.push("PR head changed after this CI run started");
  if (currentPullRequest.base?.sha !== baseSha)
    problems.push("PR base changed after this CI run started");
  if (!SHA.test(currentPullRequest.merge_commit_sha ?? ""))
    problems.push("current PR merge candidate SHA is missing or invalid");
  else if (currentPullRequest.merge_commit_sha !== sha)
    problems.push("PR merge candidate changed after this CI run started");
  return problems;
}

function readCurrentPullRequest(env) {
  if (env.GITHUB_EVENT_NAME !== "pull_request") return null;
  if (!/^\d+$/.test(env.PR_NUMBER ?? "")) return null;
  try {
    return JSON.parse(
      readBounded("gh", ["api", `repos/${env.GITHUB_REPOSITORY}/pulls/${env.PR_NUMBER}`], {
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

/** The aggregate is green only when every expected result exists and required lanes ran. */
export function ciMergeVerdict(needs, { code, db, event, ref = "" }) {
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
  if (code === "true")
    for (const id of [
      "build",
      "playwright",
      "visual-plan",
      "visual",
      "visual-report",
      "coverage-floors",
    ])
      required.add(id);
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
    const candidateProblems = ciCandidateProblems({
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
      sha: env.GITHUB_SHA,
      prNumber: env.PR_NUMBER,
      headSha: env.PR_HEAD_SHA,
      baseSha: env.PR_BASE_SHA,
      currentPullRequest: readCurrentPullRequest(env),
    });
    const problems = ciMergeVerdict(needs, {
      code: needs?.changes?.outputs?.code,
      db: needs?.changes?.outputs?.db,
      event: env.GITHUB_EVENT_NAME,
      ref: env.GITHUB_REF,
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
