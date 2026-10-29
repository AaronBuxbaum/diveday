import { describe, expect, it } from "vitest";
import { ciCandidateProblems, ciMergeVerdict } from "./ci-merge-verdict.mjs";

const jobs = [
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
const green = () => Object.fromEntries(jobs.map((id) => [id, { result: "success" }]));

describe("CI merge verdict", () => {
  it("accepts a full code run with only explicitly optional jobs skipped", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    needs["visual-flakes"].result = "skipped";
    expect(ciMergeVerdict(needs, { code: "true", db: "false", event: "pull_request" })).toEqual([]);
  });
  it("refuses missing, cancelled, unknown and improperly skipped mandatory jobs", () => {
    for (const result of ["skipped", "cancelled", "failure", "unknown", undefined]) {
      const needs = green();
      if (result === undefined) delete needs.build;
      else needs.build.result = result;
      expect(
        ciMergeVerdict(needs, { code: "true", db: "true", event: "pull_request" }),
      ).not.toEqual([]);
    }
  });
  it("requires documentation tests for docs-only changes and postgres for db changes", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    expect(ciMergeVerdict(needs, { code: "false", db: "true", event: "pull_request" })).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unit-tests-docs"),
        expect.stringContaining("real-postgres"),
      ]),
    );
  });
  it("accepts the intentional skips on a documentation-only pull request", () => {
    const needs = green();
    for (const id of [
      "unit-tests",
      "build",
      "playwright",
      "fast-lane",
      "visual-plan",
      "visual",
      "visual-report",
      "real-postgres",
      "coverage-floors",
      "visual-flakes",
    ])
      needs[id].result = "skipped";
    expect(ciMergeVerdict(needs, { code: "false", db: "false", event: "pull_request" })).toEqual(
      [],
    );
  });
  it("requires visual-flake reporting for a main code push", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    const context = { code: "true", db: "false", event: "push", ref: "refs/heads/main" };
    expect(ciMergeVerdict(needs, context)).toEqual([]);
    needs["visual-flakes"].result = "skipped";
    expect(ciMergeVerdict(needs, context)).toEqual(["visual-flakes: skipped"]);
  });
  it("fails closed when change detection evidence is missing or malformed", () => {
    expect(ciMergeVerdict(green(), { code: "", db: "false", event: "pull_request" })).not.toEqual(
      [],
    );
    expect(ciMergeVerdict(green(), { code: "true", db: "", event: "pull_request" })).not.toEqual(
      [],
    );
  });
});

describe("exact CI candidate identity", () => {
  const runSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const baseSha = "c".repeat(40);
  const currentPullRequest = {
    head: { sha: headSha },
    base: { sha: baseSha },
    merge_commit_sha: runSha,
  };
  const context = {
    event: "pull_request",
    ref: "refs/pull/42/merge",
    sha: runSha,
    prNumber: "42",
    headSha,
    baseSha,
    currentPullRequest,
  };

  it("accepts a run for the current PR head, base, and generated merge candidate", () => {
    expect(ciCandidateProblems(context)).toEqual([]);
  });

  it("rejects a rerun when the PR head or base moved after this run was created", () => {
    expect(
      ciCandidateProblems({
        ...context,
        currentPullRequest: {
          ...currentPullRequest,
          head: { sha: "d".repeat(40) },
        },
      }),
    ).toContain("PR head changed after this CI run started");
    expect(
      ciCandidateProblems({
        ...context,
        currentPullRequest: {
          ...currentPullRequest,
          base: { sha: "e".repeat(40) },
        },
      }),
    ).toContain("PR base changed after this CI run started");
  });

  it("rejects a run whose merge candidate is stale or attached to another PR ref", () => {
    expect(
      ciCandidateProblems({
        ...context,
        currentPullRequest: { ...currentPullRequest, merge_commit_sha: "f".repeat(40) },
      }),
    ).toContain("PR merge candidate changed after this CI run started");
    expect(ciCandidateProblems({ ...context, ref: "refs/pull/43/merge" })).toContain(
      "CI ref does not identify PR #42's merge candidate",
    );
  });

  it("fails closed when PR identity or current API evidence is unavailable", () => {
    expect(ciCandidateProblems({ ...context, prNumber: "" })).toContain(
      "pull request number is missing or invalid",
    );
    expect(ciCandidateProblems({ ...context, currentPullRequest: null })).toContain(
      "current pull request evidence is unavailable",
    );
  });

  it("requires a main-branch SHA for main push and dispatch runs", () => {
    expect(ciCandidateProblems({ event: "push", ref: "refs/heads/main", sha: runSha })).toEqual([]);
    expect(ciCandidateProblems({ event: "push", ref: "refs/heads/other", sha: runSha })).toContain(
      "main CI run is not on refs/heads/main",
    );
    expect(
      ciCandidateProblems({ event: "workflow_dispatch", ref: "refs/heads/main", sha: "bad" }),
    ).toContain("CI candidate SHA is missing or invalid");
  });
});
