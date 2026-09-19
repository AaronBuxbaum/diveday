import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CARRIES_THE_CONDITION,
  directNeeds,
  findStackCiSkipViolations,
  parseJobs,
  reachesRoot,
  SKIPS_BY_PROPAGATION,
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

/**
 * A minimal workflow with one job per name. A job either carries the condition
 * or declares `needs:` — the two ways a middle layer can end up skipping it.
 */
function fixture(jobs) {
  const blocks = Object.entries(jobs).map(([name, spec]) => {
    const body =
      spec === true
        ? `${STACK_CONDITION}\n`
        : `    needs: ${spec}\n    if: github.event_name != 'schedule'\n`;
    return `  ${name}:\n    name: ${name}\n${body}    runs-on: ubuntu-latest`;
  });
  return `name: CI\n\njobs:\n${blocks.join("\n")}\n`;
}

const everyJobClassified = () =>
  fixture({
    ...Object.fromEntries(CARRIES_THE_CONDITION.map((job) => [job, true])),
    build: "changes",
    visual: "build",
    "visual-report": "[visual, changes]",
    "real-postgres": "changes",
  });

describe("the real workflow", () => {
  it("classifies every job it defines", async () => {
    expect(findStackCiSkipViolations(await workflow())).toEqual([]);
  });

  it("finds the jobs by name, and no others", async () => {
    const names = [...parseJobs(await workflow()).keys()];
    expect(new Set(names)).toEqual(
      new Set([...CARRIES_THE_CONDITION, ...SKIPS_BY_PROPAGATION.keys()]),
    );
  });

  // The load-bearing half of the propagation argument, read off the real file:
  // every job that states no stack condition of its own must be reachable from
  // `changes`, or a middle layer runs it.
  it("roots every propagating job on `changes`", async () => {
    const jobs = parseJobs(await workflow());
    for (const job of SKIPS_BY_PROPAGATION.keys()) {
      expect([job, reachesRoot(job, jobs)]).toEqual([job, true]);
    }
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
      "`changes` does not carry the stack condition, byte for byte.",
    );
  });

  it("refuses a job that dropped it entirely", () => {
    const contents = everyJobClassified().replace(
      STACK_CONDITION,
      "    if: github.event_name != 'schedule'",
    );
    expect(findStackCiSkipViolations(contents)).toContain(
      "`changes` does not carry the stack condition, byte for byte.",
    );
  });
});

describe("a propagating job cut loose from `changes`", () => {
  // The quiet regression: `build` re-rooted onto something that does not reach
  // the one job carrying the condition. Nothing goes red, and every middle
  // layer starts paying for the build and the four visual shards again.
  it("refuses a job whose `needs:` no longer reaches the root", () => {
    const contents = everyJobClassified().replace(
      "  build:\n    name: build\n    needs: changes",
      "  build:\n    name: build\n    needs: lint",
    );
    // Everything rooted through `build` goes with it, which is the point: the
    // report names each job that would start running on a middle layer, not
    // only the edge somebody cut.
    expect(findStackCiSkipViolations(contents)).toEqual([
      "`build` no longer reaches `changes` through `needs:` (it needs `changes` for its `code` output), so a middle layer would run it.",
      "`visual` no longer reaches `changes` through `needs:` (it needs `build`, which needs `changes`), so a middle layer would run it.",
    ]);
  });

  it("follows the chain rather than only the direct edge", () => {
    const jobs = parseJobs(everyJobClassified());
    expect(reachesRoot("visual", jobs)).toBe(true);
    expect(directNeeds(jobs.get("visual"))).toEqual(["build"]);
    expect(directNeeds(jobs.get("visual-report"))).toEqual(["visual", "changes"]);
  });
});

describe("a job nobody classified", () => {
  it("refuses one that is in neither list", () => {
    const contents = everyJobClassified().replace(
      "jobs:\n",
      "jobs:\n  mutation-tests:\n    name: new\n    runs-on: ubuntu-latest\n",
    );
    expect(findStackCiSkipViolations(contents)).toEqual([
      "`mutation-tests` is in neither list. Decide whether a stack's middle layer should skip it by carrying the condition or by depending on `changes`, and say so in scripts/check-stack-ci-skip.mjs.",
    ]);
  });

  it("refuses a listed job that no longer exists", () => {
    const contents = everyJobClassified().replace(/ {2}lint:\n(?: {4,}.*\n)+/, "");
    expect(findStackCiSkipViolations(contents)).toContain(
      "`lint` is listed as carrying the stack condition but is not a job in .github/workflows/ci.yml.",
    );
  });
});

describe("the mechanisms this replaced", () => {
  it("refuses a surviving reference to the yield job", () => {
    const contents = everyJobClassified().replace(
      "  lint:\n",
      "  lint:\n    needs: stack-priority\n",
    );
    expect(findStackCiSkipViolations(contents)).toContain(
      "`needs: stack-priority` survives. A middle layer now skips `changes` itself, so every expensive job skips by propagation and none of them reads a separate answer.",
    );
  });

  // `middle_layer` was the output `real-postgres` read back when the visual
  // half ran on every layer and `changes` could not skip. Both are gone.
  it("refuses a surviving middle_layer output", () => {
    const contents = everyJobClassified().replace(
      "  lint:\n",
      "  lint:\n    outputs:\n      middle_layer: x\n",
    );
    expect(findStackCiSkipViolations(contents)).toContain(
      "`middle_layer` survives. A middle layer now skips `changes` itself, so every expensive job skips by propagation and none of them reads a separate answer.",
    );
  });
});
