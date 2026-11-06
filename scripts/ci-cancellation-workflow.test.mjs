import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function jobCondition(workflow, job) {
  const source = readFileSync(`.github/workflows/${workflow}.yml`, "utf8");
  const block = source.split(`\n  ${job}:\n`)[1]?.split(/\n {2}[\w-]+:\n/)[0];
  const condition = block?.match(/^ {4}if: (.+)$/m)?.[1];
  expect(condition, `${workflow}/${job} must have a job condition`).toBeDefined();
  return condition.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/\bneeds\.([\w-]+)/g, 'needs["$1"]');
}

// These job conditions use the common JS/GitHub expression subset. Model GitHub's implicit
// success() only when no status function is present, so simply removing always() does not
// accidentally pass the nightly/skipped-dependency regressions.
function runs(workflow, job, overrides = {}) {
  const {
    canceled = false,
    event = "pull_request",
    dependency = "success",
    db = "true",
    stackRun = "true",
    command = "diff",
    changed = "true",
    fork = false,
  } = overrides;
  const expression = jobCondition(workflow, job);
  if (!/\b(?:always|cancelled|success|failure)\s*\(/.test(expression)) {
    if (canceled || dependency !== "success") return false;
  }
  return runInNewContext(
    expression,
    {
      always: () => true,
      cancelled: () => canceled,
      success: () => !canceled && dependency === "success",
      failure: () => dependency === "failure",
      github: {
        event_name: event,
        repository: "shop/diveday",
        event: {
          pull_request: { head: { repo: { full_name: fork ? "fork/diveday" : "shop/diveday" } } },
        },
      },
      inputs: { command },
      needs: {
        changes: { result: dependency, outputs: { db } },
        "stack-gate": { result: dependency, outputs: { run: stackRun } },
        "infra-changed": { result: dependency, outputs: { changed } },
        diff: { result: dependency },
      },
    },
    { timeout: 100 },
  );
}

describe("CI job cancellation", () => {
  it.each([
    ["database-changing pull request", {}, true],
    ["nightly with skipped change detection", { event: "schedule", dependency: "skipped" }, true],
    ["canceled database-changing pull request", { canceled: true }, false],
    ["canceled nightly", { event: "schedule", dependency: "skipped", canceled: true }, false],
    ["non-database pull request", { db: "false" }, false],
    ["skipped lower stack layer", { db: "", dependency: "skipped" }, false],
  ])("Postgres: %s", (_name, state, expected) => {
    expect(runs("ci", "real-postgres", state)).toBe(expected);
  });

  it.each([
    ["successful jobs", {}, true],
    ["failed jobs still need a verdict and evidence", { dependency: "failure" }, true],
    ["skipped optional jobs still need a verdict", { dependency: "skipped" }, true],
    ["canceled run needs no new verdict job", { canceled: true }, false],
    ["nightly", { event: "schedule" }, false],
    ["lower stack layer", { stackRun: "false" }, false],
  ])("CI result: %s", (_name, state, expected) => {
    expect(runs("ci", "ci-result", state)).toBe(expected);
  });
});

describe("infra job cancellation", () => {
  it.each([
    ["infra-changing pull request", {}, true],
    ["pull request without infra changes", { changed: "false" }, false],
    [
      "manual diff with skipped change detection",
      { event: "workflow_dispatch", dependency: "skipped" },
      true,
    ],
    [
      "manual deploy also needs a diff",
      { event: "workflow_dispatch", command: "deploy", dependency: "skipped" },
      true,
    ],
    ["canceled pull request", { canceled: true }, false],
    [
      "canceled manual diff",
      { event: "workflow_dispatch", dependency: "skipped", canceled: true },
      false,
    ],
  ])("synth/diff: %s", (_name, state, expected) => {
    expect(runs("infra", "diff", state)).toBe(expected);
  });

  it.each([
    ["successful diff", {}, true],
    ["failed diff still needs its report", { dependency: "failure" }, true],
    ["skipped diff", { dependency: "skipped" }, false],
    ["canceled diff", { canceled: true }, false],
    ["fork pull request", { fork: true }, false],
    ["manual diff", { event: "workflow_dispatch" }, false],
  ])("comment: %s", (_name, state, expected) => {
    expect(runs("infra", "comment", state)).toBe(expected);
  });

  it.each([
    ["successful requested deploy", {}, true],
    ["canceled requested deploy", { canceled: true }, false],
    ["failed diff", { dependency: "failure" }, false],
    ["skipped diff", { dependency: "skipped" }, false],
    ["diff-only request", { command: "diff" }, false],
    ["pull request", { event: "pull_request" }, false],
  ])("deploy: %s", (_name, state, expected) => {
    expect(
      runs("infra", "deploy", { event: "workflow_dispatch", command: "deploy", ...state }),
    ).toBe(expected);
  });
});
