import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestModule, Vitest } from "vitest/node";
import {
  DURATIONS_LOG_MARKER as MERGE_MARKER,
  parseDurationsInput,
} from "../../scripts/merge-test-durations.mjs";
import DurationReporter, {
  collectDurations,
  DURATIONS_LOG_MARKER,
  durationsLogLine,
  moduleCost,
} from "./duration-reporter";

describe("moduleCost", () => {
  it("is the file's whole wall cost, import and setup included", () => {
    expect(
      moduleCost({
        environmentSetupDuration: 1,
        prepareDuration: 2,
        collectDuration: 30,
        setupDuration: 4,
        duration: 500,
      }),
    ).toBe(537);
  });
});

describe("collectDurations", () => {
  const root = path.resolve("/repo");

  it("keys by repo-relative POSIX path, rounds, and sorts", () => {
    expect(
      collectDurations(
        [
          { moduleId: path.join(root, "src/z.test.ts"), cost: 10.6 },
          { moduleId: path.join(root, "scripts/a.test.mjs"), cost: 2.2 },
        ],
        root,
      ),
    ).toEqual({ "scripts/a.test.mjs": 2, "src/z.test.ts": 11 });
    expect(
      Object.keys(
        collectDurations(
          [
            { moduleId: path.join(root, "src/z.test.ts"), cost: 1 },
            { moduleId: path.join(root, "infra/a.test.ts"), cost: 1 },
          ],
          root,
        ),
      ),
    ).toEqual(["infra/a.test.ts", "src/z.test.ts"]);
  });

  it("drops a cost that is not a duration rather than committing it", () => {
    expect(
      collectDurations(
        [
          { moduleId: path.join(root, "a.test.ts"), cost: Number.NaN },
          { moduleId: path.join(root, "b.test.ts"), cost: -5 },
        ],
        root,
      ),
    ).toEqual({});
  });
});

describe("durationsLogLine", () => {
  it("is one line the merge script reads back to the same map", () => {
    const durations = { "src/a.test.ts": 1200, "src/b.test.ts": 30 };
    const line = durationsLogLine(durations);
    expect(line).not.toContain("\n");
    expect(MERGE_MARKER).toBe(DURATIONS_LOG_MARKER);
    expect(parseDurationsInput(`2026-10-09T02:36:11.2Z ${line}`)).toEqual(durations);
  });
});

afterEach(() => vi.unstubAllEnvs());

it("records mode/source/cache/phase metadata alongside the compatible duration map", () => {
  const root = mkdtempSync(path.join(tmpdir(), "duration-reporter-"));
  try {
    vi.stubEnv("DIVEDAY_TEST_DURATIONS_OUT", path.join(root, "durations.json"));
    vi.stubEnv("GITHUB_STEP_SUMMARY", path.join(root, "summary.md"));
    vi.stubEnv("GITHUB_SHA", "source-sha");
    vi.stubEnv("GITHUB_RUN_ID", "run-1");
    vi.stubEnv("DIVEDAY_TEMPLATE_CACHE_HIT", "true");
    const reporter = new DurationReporter();
    reporter.onInit({
      config: { coverage: { enabled: true }, shard: { index: 2, count: 4 } },
    } as unknown as Vitest);
    reporter.onTestRunEnd([
      {
        moduleId: path.join(root, "a.test.ts"),
        project: { config: { root } },
        state: () => "passed",
        diagnostic: () => ({
          environmentSetupDuration: 1,
          prepareDuration: 2,
          collectDuration: 3,
          setupDuration: 4,
          duration: 5,
        }),
      },
    ] as unknown as TestModule[]);
    const artifact = JSON.parse(readFileSync(path.join(root, "durations.json"), "utf8"));
    expect(artifact).toMatchObject({
      version: 2,
      metadata: {
        sha: "source-sha",
        runId: "run-1",
        coverage: true,
        shard: 2,
        shards: 4,
        templateCacheHit: true,
        success: true,
      },
      durations: { "a.test.ts": 15 },
    });
    expect(artifact.phases["a.test.ts"].collectDuration).toBe(3);
    expect(readFileSync(path.join(root, "summary.md"), "utf8")).toContain(
      "aggregate file work 15 ms (not shard elapsed)",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
