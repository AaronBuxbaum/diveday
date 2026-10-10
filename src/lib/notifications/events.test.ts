import { describe, expect, it } from "vitest";
import { timestampFrom } from "./events";

const FALLBACK = new Date("2026-10-10T12:00:00.000Z");

describe("timestampFrom", () => {
  it("reads the first ISO candidate that parses, skipping blanks and garbage", () => {
    expect(
      timestampFrom([undefined, "", "not a date", "2026-10-09T08:30:00.000Z"], FALLBACK),
    ).toEqual(new Date("2026-10-09T08:30:00.000Z"));
  });

  it("falls back when no candidate is an instant", () => {
    expect(timestampFrom([undefined, "soon"], FALLBACK)).toBe(FALLBACK);
    expect(timestampFrom([], FALLBACK)).toBe(FALLBACK);
  });

  it("reads Meta's epoch seconds, and refuses zero, negatives and garbage", () => {
    expect(timestampFrom(["1760000000"], FALLBACK, "epoch-seconds")).toEqual(
      new Date(1_760_000_000_000),
    );
    expect(timestampFrom(["0"], FALLBACK, "epoch-seconds")).toBe(FALLBACK);
    expect(timestampFrom(["-5"], FALLBACK, "epoch-seconds")).toBe(FALLBACK);
    expect(timestampFrom(["soon"], FALLBACK, "epoch-seconds")).toBe(FALLBACK);
  });
});
