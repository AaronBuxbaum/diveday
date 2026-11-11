import { describe, expect, it } from "vitest";
import { calibrateProfiles, profileKey, replayWeights } from "./duration-profiles.mjs";

const sample = (runId, shard, ms, coverage = true, runner = "linux-x64-ubuntu24") => ({
  version: 2,
  metadata: {
    runId,
    shard,
    shards: 2,
    files: 1,
    sha: `sha${runId}`,
    coverage,
    runner,
    nodeMajor: 24,
    success: true,
    createdAt: `2026-11-0${runId}T00:00:00Z`,
  },
  durations: { [`test${shard}`]: ms },
});

describe("duration profiles", () => {
  it("uses medians of distinct complete runs, not a single noisy maximum", () => {
    const inputs = [1, 2, 3].flatMap((run) => [
      sample(run, 1, run === 3 ? 900 : 10),
      sample(run, 2, 20),
    ]);
    const result = calibrateProfiles(inputs);
    expect(result.profiles[profileKey(inputs[0].metadata)].durations).toEqual({
      test1: 10,
      test2: 20,
    });
  });
  it("does not mix coverage or runner modes, partial runs or failed runs", () => {
    expect(
      calibrateProfiles([
        sample(1, 1, 10),
        sample(2, 2, 20),
        sample(3, 1, 1, false),
        sample(3, 2, 1, false),
      ]).profiles,
    ).toEqual({});
    const inputs = [1, 2, 3].flatMap((run) => [
      sample(run, 1, 10),
      sample(run, 2, 20, true, "darwin-arm64"),
    ]);
    expect(calibrateProfiles(inputs).profiles).toEqual({});
  });
  it("refuses duplicate shards and duplicate tests instead of silently dropping work", () => {
    expect(() => calibrateProfiles([sample(1, 1, 10), sample(1, 1, 10)])).toThrow(
      /duplicate duration shard/,
    );
    const b = sample(1, 2, 20);
    b.durations = { test1: 20 };
    expect(() => calibrateProfiles([sample(1, 1, 10), b])).toThrow(/test appears twice/);
  });
  it("refuses inconsistent shard metadata and does not adopt a changed-suite intersection", () => {
    const wrong = sample(1, 2, 20);
    wrong.metadata.shards = 3;
    expect(() => calibrateProfiles([sample(1, 1, 10), wrong])).toThrow(/inconsistent/);
    const inputs = [1, 2, 3].flatMap((run) => [sample(run, 1, 10), sample(run, 2, 20)]);
    inputs[4].durations.newSlowFile = 9000;
    inputs[4].metadata.files = 2;
    expect(calibrateProfiles(inputs).profiles).toEqual({});
  });
  it("reports critical path separately from aggregate work and worst-bin error", () => {
    expect(replayWeights({ a: 4, b: 3, c: 2, d: 1 }, { a: 8, b: 3, c: 2, d: 1 }, 2)).toMatchObject({
      criticalPathMs: 9,
      totalWorkMs: 14,
      worstBinErrorMs: 4,
    });
  });
  it("adopts a profile when the suite moved by a few files between runs", () => {
    const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`test${i}`, 10 + i]));
    const run = (runId, extra = {}) => {
      const durations = { ...files, ...extra };
      return {
        version: 2,
        metadata: {
          runId,
          shard: 1,
          shards: 1,
          files: Object.keys(durations).length,
          sha: `sha${runId}`,
          coverage: true,
          runner: "linux-x64-ubuntu24",
          nodeMajor: 24,
          success: true,
          createdAt: `2026-11-0${runId}T00:00:00Z`,
        },
        durations,
      };
    };
    const adopted = calibrateProfiles([run(1), run(2), run(3, { added: 50 })]);
    const profile = Object.values(adopted.profiles)[0];
    expect(profile.validation.commonFiles).toBe(30);
    expect(profile.durations).not.toHaveProperty("added");
  });
});
