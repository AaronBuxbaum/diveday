import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DURATIONS_LOG_MARKER as MERGE_MARKER,
  parseDurationsInput,
} from "../../scripts/merge-test-durations.mjs";
import {
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
