import { describe, expect, it } from "vitest";

import { newestFailedSpecs, rankFailedSpecs } from "./e2e-recent-failures.mjs";

const failure = (path) => ({ path, annotation_level: "failure" });

describe("rankFailedSpecs", () => {
  it("ranks specs by how many failed jobs named them, once per job", () => {
    const jobs = [
      [failure("e2e/booking.spec.ts"), failure("e2e/booking.spec.ts")],
      [failure("e2e/staffing.spec.ts"), failure("e2e/booking.spec.ts")],
      [failure("e2e/staffing.spec.ts")],
      [failure("e2e/add-diver.spec.ts")],
    ];
    expect(rankFailedSpecs(jobs)).toEqual([
      "e2e/booking.spec.ts",
      "e2e/staffing.spec.ts",
      "e2e/add-diver.spec.ts",
    ]);
  });

  it("ignores warnings, non-spec paths and deleted specs, and caps the list", () => {
    const jobs = [
      [
        { path: "e2e/slow.spec.ts", annotation_level: "warning" },
        failure(".github"),
        failure("e2e/gone.spec.ts"),
        failure("e2e/a.spec.ts"),
        failure("e2e/b.spec.ts"),
      ],
    ];
    expect(
      rankFailedSpecs(jobs, { max: 1, exists: (spec) => spec !== "e2e/gone.spec.ts" }),
    ).toEqual(["e2e/a.spec.ts"]);
  });

  it("returns nothing when nothing failed", () => {
    expect(rankFailedSpecs([])).toEqual([]);
  });
});

it("uses structured github reporter title identity when an error originates in a helper", () => {
  expect(
    rankFailedSpecs([
      [
        {
          annotation_level: "failure",
          path: "e2e/helpers.ts",
          title: "[chromium] › e2e/booking.spec.ts:12:3 › booking › dashboard",
          message: "helper failed",
        },
      ],
    ]),
  ).toEqual(["e2e/booking.spec.ts"]);
});

it("distinguishes successful empty history from failed or partial pagination", async () => {
  const { readFailureHistory, pages } = await import("./e2e-recent-failures.mjs");
  expect(readFailureHistory("owner/repo", "2026-10-01", () => ({ workflow_runs: [] }))).toEqual({
    perJob: [],
    runCount: 0,
  });
  expect(() =>
    readFailureHistory("owner/repo", "2026-10-01", () => {
      throw new Error("unauthorized");
    }),
  ).toThrow("unauthorized");
  const seen = [];
  expect(
    pages("endpoint", "rows", (url) => {
      seen.push(url);
      return { rows: seen.length === 1 ? Array(100).fill({}) : [{}] };
    }),
  ).toHaveLength(101);
  expect(seen[1]).toContain("page=2");
  let count = 0;
  expect(() =>
    pages("endpoint", "rows", () => {
      if (count++) throw new Error("rate limited");
      return { rows: Array(100).fill({}) };
    }),
  ).toThrow("rate limited");
});

describe("newestFailedSpecs", () => {
  it("lists specs in the order the newest failed jobs named them, capped and existing", () => {
    const jobs = [
      [failure("e2e/newest.spec.ts"), failure("e2e/both.spec.ts")],
      [failure("e2e/both.spec.ts"), failure("e2e/older.spec.ts"), failure("e2e/gone.spec.ts")],
      [{ path: "e2e/warned.spec.ts", annotation_level: "warning" }, failure("e2e/oldest.spec.ts")],
    ];
    const exists = (spec) => spec !== "e2e/gone.spec.ts";
    expect(newestFailedSpecs(jobs, { exists })).toEqual([
      "e2e/newest.spec.ts",
      "e2e/both.spec.ts",
      "e2e/older.spec.ts",
      "e2e/oldest.spec.ts",
    ]);
    expect(newestFailedSpecs(jobs, { max: 2, exists })).toEqual([
      "e2e/newest.spec.ts",
      "e2e/both.spec.ts",
    ]);
  });

  it("reads only the newest runs when asked to", async () => {
    const { readFailureHistory } = await import("./e2e-recent-failures.mjs");
    const asked = [];
    const request = (url) => {
      asked.push(url);
      if (url.includes("/workflows/")) return { workflow_runs: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      if (url.includes("/jobs")) return { jobs: [] };
      return [];
    };
    expect(readFailureHistory("o/r", "2026-10-01", request, { maxRuns: 2 }).runCount).toBe(3);
    expect(asked.filter((url) => url.includes("/jobs"))).toHaveLength(2);
  });
});
