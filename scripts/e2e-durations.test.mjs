import { describe, expect, it } from "vitest";

import { durationsFromReport, LOG_MARKER, mergeDurations, parseInput } from "./e2e-durations.mjs";

/** The shape Playwright's JSON reporter writes: files under `rootDir` (e2e/), describes as suites. */
const report = {
  suites: [
    {
      title: "booking.spec.ts",
      file: "booking.spec.ts",
      specs: [
        { title: "books", tests: [{ results: [{ duration: 1_200 }] }] },
        { title: "cancels", tests: [{ results: [{ duration: 800 }] }] },
      ],
    },
    {
      title: "visual.spec.ts",
      file: "visual.spec.ts",
      suites: [
        {
          title: "light mode",
          specs: [{ title: "the landing page", tests: [{ results: [{ duration: 9_000 }] }] }],
        },
      ],
    },
    {
      title: "skipped.spec.ts",
      file: "skipped.spec.ts",
      specs: [{ title: "never ran", tests: [{ results: [] }] }],
    },
  ],
};

describe("durationsFromReport", () => {
  it("sums a functional spec's tests under its repo path, leaving the visual spec out", () => {
    expect(durationsFromReport(report, "functional")).toEqual({
      "e2e/booking.spec.ts": 2_000,
      "e2e/skipped.spec.ts": 0,
    });
  });

  it("keys each visual test by its --test-list line, leaving the functional specs out", () => {
    expect(durationsFromReport(report, "visual")).toEqual({
      "visual.spec.ts › light mode › the landing page": 9_000,
    });
  });

  it("refuses a kind it does not know", () => {
    expect(() => durationsFromReport(report, "unit")).toThrow(/unknown kind/);
  });
});

describe("parseInput", () => {
  const record = { kind: "functional", durations: { "e2e/a.spec.ts": 5 } };

  it("reads a recorded artifact", () => {
    expect(parseInput(JSON.stringify(record))).toEqual([record]);
  });

  it("reads the marked line out of a job log", () => {
    const log = `2026-10-10T15:24:24Z noise\n2026-10-10T15:24:24Z ${LOG_MARKER} ${JSON.stringify(record)}\n`;
    expect(parseInput(log)).toEqual([record]);
  });

  it("refuses a log with no marked line, and a negative duration", () => {
    expect(() => parseInput("just a log", "shard-1.log")).toThrow(
      /shard-1\.log: no "diveday-e2e-durations:"/,
    );
    expect(() => parseInput(JSON.stringify({ kind: "visual", durations: { x: -1 } }))).toThrow(
      /not a duration/,
    );
  });
});

describe("mergeDurations", () => {
  const existing = { functional: { "e2e/old.spec.ts": 1 }, visual: { "visual.spec.ts › kept": 2 } };

  it("replaces a kind the inputs carry, keeping the larger figure on a collision", () => {
    const next = mergeDurations(existing, [
      { kind: "functional", durations: { "e2e/b.spec.ts": 4, "e2e/a.spec.ts": 3 } },
      { kind: "functional", durations: { "e2e/a.spec.ts": 9 } },
    ]);
    expect(next.functional).toEqual({ "e2e/a.spec.ts": 9, "e2e/b.spec.ts": 4 });
    expect(Object.keys(next.functional)).toEqual(["e2e/a.spec.ts", "e2e/b.spec.ts"]);
  });

  it("keeps a kind no input carries, so one suite's refresh never wipes the other", () => {
    const next = mergeDurations(existing, [
      { kind: "functional", durations: { "e2e/b.spec.ts": 4 } },
    ]);
    expect(next.visual).toEqual(existing.visual);
    expect(next["//"]).toMatch(/never edited by hand/);
  });
});
