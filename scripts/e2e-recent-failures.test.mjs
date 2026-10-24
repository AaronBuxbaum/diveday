import { describe, expect, it } from "vitest";

import { rankFailedSpecs } from "./e2e-recent-failures.mjs";

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
      rankFailedSpecs(jobs, {
        max: 1,
        exists: (spec) => spec !== "e2e/gone.spec.ts",
      }),
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
          path: "e2e/a11y-scan.ts",
          title: "[chromium] › e2e/a11y.spec.ts:12:3 › accessibility › dashboard",
          message: "helper failed",
        },
      ],
    ]),
  ).toEqual(["e2e/a11y.spec.ts"]);
});

it("distinguishes successful empty history from failed or partial pagination", async () => {
  const { readFailureHistory, pages } = await import("./e2e-recent-failures.mjs");
  expect(
    readFailureHistory("owner/repo", "2026-10-01", () => ({
      workflow_runs: [],
    })),
  ).toEqual({
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

it("reads a full page of 100 failed CI runs, which overflowed execFileSync's 1 MiB (2026-10-23)", async () => {
  // One page of 100 failed ci.yml runs was 1.27 MB once the 7-day window held 97 of them; the
  // default buffer killed gh with ENOBUFS and the nightly flake hunt exited "could not read CI
  // history" on 2026-10-23 and 2026-10-24 (#2976).
  const { ghJson } = await import("./e2e-recent-failures.mjs");
  const page = JSON.stringify({
    workflow_runs: Array.from({ length: 100 }, (_, id) => ({
      id,
      padding: "x".repeat(13_000),
    })),
  });
  const read = (_command, _args, options) => {
    if (Buffer.byteLength(page) > (options.maxBuffer ?? 1024 * 1024)) {
      throw Object.assign(new Error("spawnSync gh ENOBUFS"), {
        code: "ENOBUFS",
      });
    }
    return page;
  };
  expect(ghJson("repos/o/r/actions/workflows/ci.yml/runs", read).workflow_runs).toHaveLength(100);
});
