import { describe, expect, it } from "vitest";

import { newestFailedSpecs, rankFailedSpecs, rankFailedTests } from "./e2e-recent-failures.mjs";

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

describe("ghJson retries (#3641)", () => {
  const failure = (stderr) => Object.assign(new Error("Command failed: gh api"), { stderr });

  it("asks again after one HTTP 502 and returns the normal result", async () => {
    const { ghJson } = await import("./e2e-recent-failures.mjs");
    const pauses = [];
    let calls = 0;
    const read = () => {
      calls += 1;
      if (calls === 1) throw failure("gh: Server Error (HTTP 502)");
      return JSON.stringify({ workflow_runs: [{ id: 1 }] });
    };
    expect(ghJson("repos/o/r/x", read, (ms) => pauses.push(ms)).workflow_runs).toHaveLength(1);
    expect(calls).toBe(2);
    expect(pauses).toHaveLength(1);
  });

  it("gives up after three attempts and rethrows the persistent failure", async () => {
    const { ghJson } = await import("./e2e-recent-failures.mjs");
    let calls = 0;
    const read = () => {
      calls += 1;
      throw failure("gh: Bad Gateway (HTTP 502)");
    };
    expect(() => ghJson("repos/o/r/x", read, () => {})).toThrow("Command failed");
    expect(calls).toBe(3);
  });

  it("never retries a 4xx", async () => {
    const { ghJson } = await import("./e2e-recent-failures.mjs");
    let calls = 0;
    const read = () => {
      calls += 1;
      throw failure("gh: Not Found (HTTP 404)");
    };
    expect(() => ghJson("repos/o/r/x", read, () => {})).toThrow();
    expect(calls).toBe(1);
  });
});

describe("rankFailedTests", () => {
  const titled = (title) => ({
    annotation_level: "failure",
    path: "e2e/helpers.ts",
    title,
  });

  it("names the failed tests so the hunt reruns them and not their whole files", () => {
    const result = rankFailedTests([
      [
        titled("[chromium] › e2e/booking.spec.ts:12:3 › booking › pays (deposit)"),
        titled("[chromium] › e2e/booking.spec.ts:40:3 › booking › pays (deposit)"),
      ],
    ]);
    expect(result.specs).toEqual(["e2e/booking.spec.ts"]);
    expect(result.tests).toBe(1);
    expect(new RegExp(result.grep).test("booking pays (deposit)")).toBe(true);
    expect(new RegExp(result.grep).test("booking pays (deposit) twice")).toBe(false);
  });

  it("reruns whole files when any failure has no readable title", () => {
    const result = rankFailedTests([
      [
        titled("[chromium] › e2e/booking.spec.ts:12:3 › booking › pays"),
        { annotation_level: "failure", path: "e2e/staffing.spec.ts" },
      ],
    ]);
    expect(result.specs).toEqual(["e2e/booking.spec.ts", "e2e/staffing.spec.ts"]);
    expect(result.grep).toBeNull();
  });
});
