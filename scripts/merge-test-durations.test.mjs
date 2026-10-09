import { describe, expect, it } from "vitest";
import {
  DURATIONS_LOG_MARKER,
  mergeDurations,
  parseDurationsInput,
} from "./merge-test-durations.mjs";

describe("mergeDurations", () => {
  it("is the union of every shard, sorted by path", () => {
    expect(
      mergeDurations([{ "src/b.test.ts": 20 }, { "src/a.test.ts": 10, "infra/c.test.ts": 5.4 }]),
    ).toEqual({ "infra/c.test.ts": 5, "src/a.test.ts": 10, "src/b.test.ts": 20 });
    expect(Object.keys(mergeDurations([{ b: 1 }, { a: 1 }]))).toEqual(["a", "b"]);
  });

  it("keeps the larger figure when two inputs name the same file", () => {
    expect(mergeDurations([{ a: 10 }, { a: 30 }, { a: 20 }])).toEqual({ a: 30 });
  });

  it("refuses an input that is not a map of durations", () => {
    expect(() => mergeDurations([[1, 2]])).toThrow(/one JSON object/);
    expect(() => mergeDurations([{ a: "slow" }])).toThrow(/not a duration/);
    expect(() => mergeDurations([{ a: -1 }])).toThrow(/not a duration/);
  });
});

describe("parseDurationsInput", () => {
  it("reads an artifact's JSON as it is", () => {
    expect(parseDurationsInput('{\n  "a.test.ts": 12\n}\n')).toEqual({ "a.test.ts": 12 });
  });

  it("reads the marked line out of a timestamped job log", () => {
    const log = [
      "2026-10-09T02:36:10.1Z ....................",
      `2026-10-09T02:36:11.2Z ${DURATIONS_LOG_MARKER} {"src/a.test.ts":1200,"src/b.test.ts":30}`,
      "2026-10-09T02:36:14.6Z Cleaning up orphan processes",
    ].join("\r\n");
    expect(parseDurationsInput(log)).toEqual({ "src/a.test.ts": 1200, "src/b.test.ts": 30 });
  });

  it("refuses a log with no marked line, or two", () => {
    expect(() => parseDurationsInput("no durations here", "shard-1.log")).toThrow(
      /shard-1\.log: expected one .* found 0/,
    );
    const twice = `${DURATIONS_LOG_MARKER} {"a":1}\n${DURATIONS_LOG_MARKER} {"b":2}`;
    expect(() => parseDurationsInput(twice)).toThrow(/found 2/);
  });
});
