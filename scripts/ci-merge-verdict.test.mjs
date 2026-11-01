import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ciCandidateProblems, ciMergeVerdict } from "./ci-merge-verdict.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CI_MERGE_VERDICT_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "ci-merge-verdict.mjs",
);

const jobs = [
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
const green = () => Object.fromEntries(jobs.map((id) => [id, { result: "success" }]));

function runWithFakeGh(responses) {
  const directory = mkdtempSync(join(tmpdir(), "diveday-ci-merge-verdict-"));
  const bin = join(directory, "bin");
  const fakeGh = join(bin, "gh");
  const log = join(directory, "gh-calls.jsonl");
  try {
    mkdirSync(bin);
    writeFileSync(
      fakeGh,
      `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
const resource = args[1];
let previous = [];
try { previous = readFileSync(process.env.FAKE_GH_LOG, "utf8").trim().split("\\n").filter(Boolean); } catch {}
const count = previous.map((line) => JSON.parse(line)).filter((call) => call[1] === resource).length;
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\\n");
const response = JSON.parse(process.env.FAKE_GH_RESPONSES)[resource];
const selected = Array.isArray(response) ? response[count] : response;
if (args[0] !== "api" || selected == null) process.exit(1);
process.stdout.write(JSON.stringify(selected));
`,
    );
    chmodSync(fakeGh, 0o755);
    const needs = green();
    needs.changes.outputs = { code: "true", db: "false" };
    const result = runBounded(process.execPath, [CI_MERGE_VERDICT_SCRIPT], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        CI_NEEDS: JSON.stringify(needs),
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/pull/42/merge",
        GITHUB_SHA: RUN_SHA,
        GITHUB_REPOSITORY: REPOSITORY,
        PR_NUMBER: "42",
        PR_HEAD_SHA: HEAD_SHA,
        PR_BASE_SHA: BASE_SHA,
        PR_IS_FORK: "false",
        FAKE_GH_LOG: log,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        PATH: `${bin}${pathDelimiter}${process.env.PATH ?? ""}`,
      },
      timeoutMs: Math.min(10_000, SUBPROCESS_TIMEOUTS.nodeScript),
    });
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { result, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const pathDelimiter = process.platform === "win32" ? ";" : ":";
const REPOSITORY = "AaronBuxbaum/diveday";
const RUN_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const BASE_SHA = "c".repeat(40);
const CURRENT_SHA = "d".repeat(40);
const TREE_SHA = "e".repeat(40);
const FIRST_PARENT_SHA = "f".repeat(40);
const PULL_REQUEST_ENDPOINT = `repos/${REPOSITORY}/pulls/42`;
const RUN_COMMIT_ENDPOINT = `repos/${REPOSITORY}/git/commits/${RUN_SHA}`;
const CURRENT_COMMIT_ENDPOINT = `repos/${REPOSITORY}/git/commits/${CURRENT_SHA}`;
const pullRequest = (overrides = {}) => ({
  head: { sha: HEAD_SHA },
  base: { sha: BASE_SHA },
  merge_commit_sha: CURRENT_SHA,
  ...overrides,
});
const commit = (sha) => ({
  sha,
  tree: { sha: TREE_SHA },
  parents: [{ sha: FIRST_PARENT_SHA }, { sha: HEAD_SHA }],
});

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
  it("lets coverage-floors skip only when change detection says no safety file moved", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    needs["visual-flakes"].result = "skipped";
    needs["coverage-floors"].result = "skipped";
    const context = { code: "true", db: "false", event: "pull_request" };
    expect(ciMergeVerdict(needs, { ...context, safety: "false" })).toEqual([]);
    expect(ciMergeVerdict(needs, { ...context, safety: "true" })).toEqual([
      "coverage-floors: skipped",
    ]);
    // A missing or malformed output fails closed: the floors are required.
    expect(ciMergeVerdict(needs, context)).toEqual(["coverage-floors: skipped"]);
    expect(ciMergeVerdict(needs, { ...context, safety: undefined })).toEqual([
      "coverage-floors: skipped",
    ]);
  });
  it("lets the browser lanes skip only when change detection says unit-test files alone changed", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    needs["visual-flakes"].result = "skipped";
    for (const id of [
      "build",
      "playwright",
      "fast-lane",
      "visual-plan",
      "visual",
      "visual-publish",
      "visual-report",
    ])
      needs[id].result = "skipped";
    const context = { code: "true", db: "false", event: "pull_request" };
    expect(ciMergeVerdict(needs, { ...context, browser: "false" })).toEqual([]);
    expect(ciMergeVerdict(needs, { ...context, browser: "true" })).toEqual(
      expect.arrayContaining(["build: skipped", "playwright: skipped", "visual-report: skipped"]),
    );
    expect(ciMergeVerdict(needs, context)).toEqual(expect.arrayContaining(["build: skipped"]));
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
  it("allows the publisher job to skip on a fork PR while requiring the report job", () => {
    const needs = green();
    needs["unit-tests-docs"].result = "skipped";
    needs["real-postgres"].result = "skipped";
    needs["visual-publish"].result = "skipped";
    expect(
      ciMergeVerdict(needs, { code: "true", db: "false", event: "pull_request", fork: true }),
    ).toEqual([]);
    expect(
      ciMergeVerdict(needs, { code: "true", db: "false", event: "pull_request", fork: false }),
    ).toContain("visual-publish: skipped");
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

describe("CI merge verdict CLI with bounded GitHub REST", () => {
  it("keeps the exact-SHA fast path free of commit lookups", () => {
    const { result, calls } = runWithFakeGh({
      [PULL_REQUEST_ENDPOINT]: pullRequest({ merge_commit_sha: RUN_SHA }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual([["api", PULL_REQUEST_ENDPOINT]]);
  });

  it("reads both commit objects and accepts equivalent changed-SHA candidates", () => {
    const { result, calls } = runWithFakeGh({
      [PULL_REQUEST_ENDPOINT]: [pullRequest(), pullRequest()],
      [RUN_COMMIT_ENDPOINT]: commit(RUN_SHA),
      [CURRENT_COMMIT_ENDPOINT]: commit(CURRENT_SHA),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("CI result: all required jobs passed");
    expect(calls).toEqual([
      ["api", PULL_REQUEST_ENDPOINT],
      ["api", RUN_COMMIT_ENDPOINT],
      ["api", CURRENT_COMMIT_ENDPOINT],
      ["api", PULL_REQUEST_ENDPOINT],
    ]);
  });

  it("fails closed when either commit lookup fails", () => {
    const { result, calls } = runWithFakeGh({
      [PULL_REQUEST_ENDPOINT]: pullRequest(),
      [RUN_COMMIT_ENDPOINT]: commit(RUN_SHA),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "PR merge candidate tree/parent evidence is missing or invalid",
    );
    expect(calls).toEqual([
      ["api", PULL_REQUEST_ENDPOINT],
      ["api", RUN_COMMIT_ENDPOINT],
      ["api", CURRENT_COMMIT_ENDPOINT],
    ]);
  });

  it("fails closed if head, base, or merge SHA moves during commit lookup", () => {
    const changes = [
      pullRequest({ head: { sha: "1".repeat(40) } }),
      pullRequest({ base: { sha: "1".repeat(40) } }),
      pullRequest({ merge_commit_sha: "1".repeat(40) }),
    ];
    for (const latest of changes) {
      const { result, calls } = runWithFakeGh({
        [PULL_REQUEST_ENDPOINT]: [pullRequest(), latest],
        [RUN_COMMIT_ENDPOINT]: commit(RUN_SHA),
        [CURRENT_COMMIT_ENDPOINT]: commit(CURRENT_SHA),
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "PR merge candidate tree/parent evidence is missing or invalid",
      );
      expect(calls.at(-1)).toEqual(["api", PULL_REQUEST_ENDPOINT]);
    }
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

  it("accepts different generated merge SHAs only when tree and ordered parents match", () => {
    const currentSha = "d".repeat(40);
    const treeSha = "e".repeat(40);
    const parents = ["f".repeat(40), headSha];
    const commit = (sha) => ({
      sha,
      tree: { sha: treeSha },
      parents: parents.map((parentSha) => ({ sha: parentSha })),
    });
    expect(
      ciCandidateProblems({
        ...context,
        currentPullRequest: { ...currentPullRequest, merge_commit_sha: currentSha },
        candidateCommits: { run: commit(runSha), current: commit(currentSha) },
      }),
    ).toEqual([]);
  });

  it("refuses a different tree or a different ordered parent list", () => {
    const currentSha = "d".repeat(40);
    const treeSha = "e".repeat(40);
    const parents = ["f".repeat(40), headSha];
    const commit = (sha, tree, orderedParents) => ({
      sha,
      tree: { sha: tree },
      parents: orderedParents.map((parentSha) => ({ sha: parentSha })),
    });
    const current = { ...currentPullRequest, merge_commit_sha: currentSha };
    const runEvidence = commit(runSha, treeSha, parents);
    expect(
      ciCandidateProblems({
        ...context,
        currentPullRequest: current,
        candidateCommits: {
          run: runEvidence,
          current: commit(currentSha, "1".repeat(40), parents),
        },
      }),
    ).toContain("PR merge candidate tree or parents changed after this CI run started");
    expect(
      ciCandidateProblems({
        ...context,
        currentPullRequest: current,
        candidateCommits: {
          run: runEvidence,
          current: commit(currentSha, treeSha, ["1".repeat(40), headSha]),
        },
      }),
    ).toContain("PR merge candidate tree or parents changed after this CI run started");
  });

  it("fails closed when changed-SHA commit evidence is missing or malformed", () => {
    const currentSha = "d".repeat(40);
    const treeSha = "e".repeat(40);
    const commit = (sha, parents) => ({
      sha,
      tree: { sha: treeSha },
      parents: parents.map((parentSha) => ({ sha: parentSha })),
    });
    const changed = {
      ...context,
      currentPullRequest: { ...currentPullRequest, merge_commit_sha: currentSha },
    };
    expect(ciCandidateProblems(changed)).toContain(
      "PR merge candidate tree/parent evidence is missing or invalid",
    );
    expect(
      ciCandidateProblems({
        ...changed,
        candidateCommits: {
          run: commit(runSha, [headSha]),
          current: commit(currentSha, [headSha]),
        },
      }),
    ).toContain("PR merge candidate tree/parent evidence is missing or invalid");
    for (const parents of [
      ["f".repeat(40), headSha, "1".repeat(40)],
      ["f".repeat(40), "0".repeat(40)],
    ]) {
      expect(
        ciCandidateProblems({
          ...changed,
          candidateCommits: {
            run: commit(runSha, parents),
            current: commit(currentSha, parents),
          },
        }),
      ).toContain("PR merge candidate tree/parent evidence is missing or invalid");
    }
    expect(
      ciCandidateProblems({
        ...changed,
        candidateCommits: {
          run: commit(runSha, ["f".repeat(40), "1".repeat(40)]),
          current: commit(currentSha, ["f".repeat(40), "1".repeat(40)]),
        },
      }),
    ).toContain("PR merge candidate tree/parent evidence is missing or invalid");
    expect(
      ciCandidateProblems({
        ...changed,
        candidateCommits: {
          run: { ...commit(runSha, ["f".repeat(40), headSha]), sha: { toString: () => runSha } },
          current: commit(currentSha, ["f".repeat(40), headSha]),
        },
      }),
    ).toContain("PR merge candidate tree/parent evidence is missing or invalid");
  });

  it("rejects a rerun when the PR head or base moved after this run was created", () => {
    const currentSha = "d".repeat(40);
    const treeSha = "e".repeat(40);
    const parents = ["f".repeat(40), headSha];
    const commit = (sha) => ({
      sha,
      tree: { sha: treeSha },
      parents: parents.map((parentSha) => ({ sha: parentSha })),
    });
    const changedMerge = {
      ...context,
      currentPullRequest: { ...currentPullRequest, merge_commit_sha: currentSha },
      candidateCommits: { run: commit(runSha), current: commit(currentSha) },
    };
    expect(
      ciCandidateProblems({
        ...changedMerge,
        currentPullRequest: {
          ...changedMerge.currentPullRequest,
          head: { sha: "d".repeat(40) },
        },
      }),
    ).toContain("PR head changed after this CI run started");
    expect(
      ciCandidateProblems({
        ...changedMerge,
        currentPullRequest: {
          ...changedMerge.currentPullRequest,
          base: { sha: "e".repeat(40) },
        },
      }),
    ).toContain("PR base changed after this CI run started");
  });

  it("refuses an unverified merge candidate or a run attached to another PR ref", () => {
    expect(
      ciCandidateProblems({
        ...context,
        currentPullRequest: { ...currentPullRequest, merge_commit_sha: "f".repeat(40) },
      }),
    ).toContain("PR merge candidate tree/parent evidence is missing or invalid");
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
