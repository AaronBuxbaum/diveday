import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  findStackCiSkipViolations,
  parseJobs,
  RUNS_ON_EVERY_LAYER,
  SKIPS_A_MIDDLE_LAYER,
  STACK_CONDITION,
} from "./check-stack-ci-skip.mjs";

/**
 * The rule guards a failure that is silent in both directions: a job that runs
 * when it should not merely wastes a runner, and a job that skips when it
 * should not lets a layer merge ungated — and GitHub reports a skipped job as
 * *successful*, so neither shows up as a red check. Nothing here can be proven
 * by reading CI output, which is the whole reason it is a check.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = () => readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** A minimal workflow with one job per name, carrying the condition or not. */
function fixture(jobs) {
  const blocks = Object.entries(jobs).map(
    ([name, condition]) =>
      `  ${name}:\n    name: ${name}\n${condition ? `${STACK_CONDITION}\n` : "    if: github.event_name != 'schedule'\n"}    runs-on: ubuntu-latest`,
  );
  return `name: CI\n\njobs:\n${blocks.join("\n")}\n`;
}

const everyJobClassified = () =>
  fixture(
    Object.fromEntries([
      ...SKIPS_A_MIDDLE_LAYER.map((job) => [job, true]),
      ...[...RUNS_ON_EVERY_LAYER.keys()].map((job) => [job, false]),
    ]),
  );

describe("the real workflow", () => {
  it("classifies every job it defines", async () => {
    expect(findStackCiSkipViolations(await workflow())).toEqual([]);
  });

  it("finds the jobs by name, and no others", async () => {
    const names = [...parseJobs(await workflow()).keys()];
    expect(new Set(names)).toEqual(
      new Set([...SKIPS_A_MIDDLE_LAYER, ...RUNS_ON_EVERY_LAYER.keys()]),
    );
  });
});

describe("a fixture with nothing wrong with it", () => {
  it("passes", () => {
    expect(findStackCiSkipViolations(everyJobClassified())).toEqual([]);
  });
});

describe("a condition that drifts", () => {
  it("refuses a job that lost its last clause", () => {
    const weakened = `${STACK_CONDITION.split("\n").slice(0, -1).join("\n")})`;
    const contents = everyJobClassified().replace(STACK_CONDITION, weakened);
    expect(findStackCiSkipViolations(contents)).toContain(
      "`repo-safeguards` does not carry the stack condition, byte for byte.",
    );
  });

  it("refuses a job that dropped it entirely", () => {
    const contents = everyJobClassified().replace(
      STACK_CONDITION,
      "    if: github.event_name != 'schedule'",
    );
    expect(findStackCiSkipViolations(contents)).toContain(
      "`repo-safeguards` does not carry the stack condition, byte for byte.",
    );
  });
});

describe("the visual path", () => {
  it("refuses the condition on a job the layer above is keyed to", () => {
    const contents = everyJobClassified().replace(
      "  visual:\n    name: visual\n    if: github.event_name != 'schedule'",
      `  visual:\n    name: visual\n${STACK_CONDITION}`,
    );
    const violations = findStackCiSkipViolations(contents);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^`visual` carries the stack condition and must not:/);
  });
});

describe("a job nobody classified", () => {
  it("refuses one that is in neither list", () => {
    const contents = everyJobClassified().replace(
      "jobs:\n",
      "jobs:\n  mutation-tests:\n    name: new\n    runs-on: ubuntu-latest\n",
    );
    expect(findStackCiSkipViolations(contents)).toEqual([
      "`mutation-tests` is in neither list. Decide whether a stack's middle layer should skip it, and say so in scripts/check-stack-ci-skip.mjs.",
    ]);
  });

  it("refuses a listed job that no longer exists", () => {
    const contents = everyJobClassified().replace(/ {2}lint:\n(?: {4}.*\n)+/, "");
    expect(findStackCiSkipViolations(contents)).toContain(
      "`lint` is listed as skipping a middle layer but is not a job in .github/workflows/ci.yml.",
    );
  });
});

describe("the gate this replaced", () => {
  it("refuses a surviving reference to the yield job", () => {
    const contents = everyJobClassified().replace(
      "  lint:\n",
      "  lint:\n    needs: stack-priority\n",
    );
    expect(findStackCiSkipViolations(contents)).toContain(
      "`needs: stack-priority` survives. The yield job it belonged to is gone — a middle layer skips now rather than waiting.",
    );
  });
});
