import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { filterStep, findCiChangeDetectionViolations } from "./check-ci-change-detection.mjs";

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
  "          BASE_REF: ${{ github.event.pull_request.base.ref }}",
  "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
  "          BEFORE_SHA: ${{ github.event.before }}",
  "        run: |",
  '          db_paths=$(git diff --name-only "${base}...${head}" -- src/db)',
].join("\n");

describe("the range change detection asks about", () => {
  it("refuses the recorded base sha, which is what shipped the bug", () => {
    const step = [
      "        env:",
      "          BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}",
      "        run: |",
      '          db_paths=$(git diff --name-only "${BASE_SHA}...HEAD" -- src/db)',
    ].join("\n");
    const violations = findCiChangeDetectionViolations(fixture(step));
    expect(violations.join("\n")).toContain("base.sha");
    expect(violations.join("\n")).toContain("never advances");
  });

  it("refuses a base resolved neither by ref nor by sha", () => {
    const step = [
      "        run: |",
      '          db_paths=$(git diff --name-only "main...HEAD")',
    ].join("\n");
    expect(findCiChangeDetectionViolations(fixture(step)).join("\n")).toContain("base.ref");
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
      "          BASE_REF: ${{ github.event.pull_request.base.ref }}",
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
  it("asks the right question", async () => {
    expect(findCiChangeDetectionViolations(await workflow())).toEqual([]);
  });

  it("fetches the base ref without a depth, so merge-base sees real history", async () => {
    const step = filterStep(await workflow());
    expect(step).toContain('git fetch --no-tags origin "${BASE_REF}"');
    // `fetch-depth: 0` on the checkout already brought the history; a shallow
    // fetch here grafts a boundary on and merge-base computes against a
    // truncated ancestry.
    expect(step).not.toMatch(/git fetch[^\n]*--depth/);
  });

  it("lets a failed fetch fail open rather than failing the job", async () => {
    const step = filterStep(await workflow());
    // `set -euo pipefail` is in force, so an unguarded fetch would abort the
    // step — the opposite of the fail-open contract the step is written around.
    expect(step).toMatch(/git fetch[^\n]*\|\| true/);
    expect(step).toContain("running everything");
  });
});
