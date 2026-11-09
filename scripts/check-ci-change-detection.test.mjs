import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { filterStep, findCiChangeDetectionViolations } from "./check-ci-change-detection.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * The guard exists because the bug it catches is invisible: change detection
 * fails *open*, so a range that answers the wrong question still leaves every
 * check green. The only symptom is spent runner minutes and visual diffs
 * charged to a pull request that cannot have caused them (issue #1295).
 *
 * The first test below is the regression: it is the exact shape the workflow
 * carried until 2026-09-02.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = () => readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** A `changes` job with one `filter` step, wrapped enough to be found. */
function fixture(step) {
  return [
    "jobs:",
    "  changes:",
    "    name: Detect what changed",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - id: filter",
    step,
    "      - id: after",
    "        run: echo done",
    "",
    "  lint:",
    "    name: Lint",
    "",
  ].join("\n");
}

const CURRENT = [
  "        env:",
  "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
  "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  "          BEFORE_SHA: ${{ github.event.before }}",
  "        run: |",
  '          db_paths=$(git diff --name-only "${base}...${head}" -- src/db)',
].join("\n");

describe("the range change detection asks about", () => {
  it("refuses the live base branch, which let a merged PR read as docs-only", () => {
    const step = [
      "        env:",
      "          BASE_REF: ${{ github.event.pull_request.base.ref }}",
      "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
      "          BEFORE_SHA: ${{ github.event.before }}",
      "        run: |",
      '          db_paths=$(git diff --name-only "origin/${BASE_REF}...${HEAD_SHA}" -- src/db)',
    ].join("\n");
    const violations = findCiChangeDetectionViolations(fixture(step)).join("\n");
    expect(violations).toContain("#3259");
    expect(violations).toContain("pin both ends");
  });

  it("refuses a range that ends at the checked-out merge commit", () => {
    const step = CURRENT.replace('"${base}...${head}"', '"${BASE_SHA}...HEAD"');
    expect(findCiChangeDetectionViolations(fixture(step)).join("\n")).toContain("#1295");
  });

  it("refuses collapsing the push path into the pull-request range", () => {
    const step = CURRENT.replace("          BEFORE_SHA: ${{ github.event.before }}\n", "");
    const violations = findCiChangeDetectionViolations(fixture(step)).join("\n");
    expect(violations).toContain("github.event.before");
    // Named because a reader deleting that line is about to blind main's baseline.
    expect(violations).toContain("#1277");
  });

  it("refuses a two-dot range, which lists main's new files as deletions", () => {
    const step = CURRENT.replace('"${base}...${head}"', '"${base}..${head}"');
    expect(findCiChangeDetectionViolations(fixture(step)).join("\n")).toContain("not three-dot");
  });

  it("refuses a filter step that diffs nothing at all", () => {
    const step = [
      "        env:",
      "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
      "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
      "          BEFORE_SHA: ${{ github.event.before }}",
      '        run: echo code=true >> "$GITHUB_OUTPUT"',
    ].join("\n");
    expect(findCiChangeDetectionViolations(fixture(step)).join("\n")).toContain("decides nothing");
  });

  it("passes the shape the workflow carries now", () => {
    expect(findCiChangeDetectionViolations(fixture(CURRENT))).toEqual([]);
  });

  it("says so rather than passing when the step has been renamed away", () => {
    const violations = findCiChangeDetectionViolations("jobs:\n  changes:\n    steps: []\n");
    expect(violations.join("\n")).toContain("cannot check a step it cannot find");
  });
});

describe("the workflow itself", () => {
  it("keeps auxiliary browser harness inputs selected without widening ordinary unit-only changes", async () => {
    const condition = filterStep(await workflow())
      .split("\n")
      .find((line) => line.includes("if [") && line.includes("grep -Ev '[.]test[.]"));
    expect(condition).toBeTruthy();
    for (const [files, isPr, expected] of [
      ["scripts/reg-report-ui/report.spec.mts", "1", "true"],
      ["scripts/reg-report-ui/fixture.test.mts", "1", "true"],
      ["scripts/persona-bots/onboard.test.mjs", "1", "true"],
      ["patches/reg-cli@0.18.16.patch", "1", "true"],
      ["pnpm-workspace.yaml", "1", "true"],
      ["scripts/ordinary.test.mjs", "1", "false"],
      ["scripts/ordinary.test.mjs", "", "true"],
    ]) {
      const result = runBounded(
        "bash",
        ["-c", `${condition}\nprintf false\nelse\nprintf true\nfi`],
        {
          encoding: "utf8",
          timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
          env: { ...process.env, IS_PR: isPr, code_paths: files },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, `${files} (PR=${isPr || "no"})`).toBe(expected);
    }
  });

  it("asks the right question", async () => {
    expect(findCiChangeDetectionViolations(await workflow())).toEqual([]);
  });

  it("reads the pinned shas from the event and runs no fetch of its own", async () => {
    const step = filterStep(await workflow());
    expect(step).toContain("BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(step).toContain("HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(step).not.toMatch(/git fetch/);
  });

  it("runs everything when a pinned commit cannot be resolved", async () => {
    const step = filterStep(await workflow());
    expect(step).toContain("git rev-parse --verify -q");
    expect(step).toContain("running everything");
  });
});

describe("a base that advances during the run (issue #3259)", () => {
  it("still sees the PR's own change through the event-pinned range", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ci-detect-"));
    const git = (...args) =>
      execFileSync("git", ["-C", dir, "-c", "user.email=a@b.c", "-c", "user.name=t", ...args], {
        encoding: "utf8",
      }).trim();
    git("init", "-q", "-b", "main");
    writeFileSync(path.join(dir, "README.md"), "docs\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const baseSha = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "pr");
    writeFileSync(path.join(dir, "settings.tsx"), "export {};\n");
    git("add", "-A");
    git("commit", "-q", "-m", "pr change");
    const headSha = git("rev-parse", "HEAD");
    // The PR merges while detection runs: the live main now contains the PR head.
    git("checkout", "-q", "main");
    git("merge", "-q", "--ff-only", "pr");

    expect(git("diff", "--name-only", "main...pr")).toBe("");
    expect(git("diff", "--name-only", `${baseSha}...${headSha}`)).toBe("settings.tsx");
  });
});
