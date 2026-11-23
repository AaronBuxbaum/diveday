import { describe, expect, it } from "vitest";

import { lowerLayers, MAX_ATTEMPTS, staleRuns } from "./ci-lower-layer-sweep.mjs";

const pr = (number, sha, labels = [], state = "open") => ({
  number,
  state,
  head: { sha },
  labels: labels.map((name) => ({ name })),
});
const run = (id, head_sha, conclusion, extra = {}) => ({
  id,
  head_sha,
  event: "pull_request",
  status: "completed",
  conclusion,
  run_attempt: 1,
  ...extra,
});

describe("lowerLayers", () => {
  it("returns every open layer except the top", () => {
    const stack = {
      pull_requests: [{ number: 1 }, { number: 2 }, { number: 3 }],
    };
    const layers = lowerLayers(stack, [pr(1, "a"), pr(2, "b"), pr(3, "c")]);
    expect(layers.map((l) => l.number)).toEqual([1, 2]);
  });
  it("leaves out a layer that already merged", () => {
    const stack = {
      pull_requests: [{ number: 1 }, { number: 2 }, { number: 3 }],
    };
    expect(lowerLayers(stack, [pr(2, "b"), pr(3, "c")]).map((l) => l.number)).toEqual([2]);
  });
});

describe("staleRuns", () => {
  const layer = (number, head_sha, labels = []) => ({
    number,
    head_sha,
    labels,
  });
  it("re-runs a failed or cancelled run on a lower layer's head", () => {
    const picked = staleRuns(
      [layer(1, "a"), layer(2, "b")],
      [run(10, "a", "failure"), run(11, "b", "cancelled")],
    );
    expect(picked).toEqual([
      { pr: 1, run: 10 },
      { pr: 2, run: 11 },
    ]);
  });
  it("leaves a green, skipped or still-running layer alone", () => {
    const picked = staleRuns(
      [layer(1, "a"), layer(2, "b"), layer(3, "c")],
      [
        run(10, "a", "success"),
        run(11, "b", null, { status: "in_progress" }),
        run(12, "c", "skipped"),
      ],
    );
    expect(picked).toEqual([]);
  });
  it("judges only the newest run on a head", () => {
    expect(staleRuns([layer(1, "a")], [run(10, "a", "failure"), run(11, "a", "success")])).toEqual(
      [],
    );
  });
  it("ignores a run from an older head", () => {
    expect(staleRuns([layer(1, "new")], [run(10, "old", "failure")])).toEqual([]);
  });
  it("leaves a ci-now layer to its own real result", () => {
    expect(staleRuns([layer(1, "a", ["ci-now"])], [run(10, "a", "failure")])).toEqual([]);
  });
  it("stops after the attempt cap so a gate that keeps running cannot loop", () => {
    expect(
      staleRuns([layer(1, "a")], [run(10, "a", "failure", { run_attempt: MAX_ATTEMPTS })]),
    ).toEqual([]);
  });
});
