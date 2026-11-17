import { describe, expect, it } from "vitest";
import { compareDeckCount, DECK_COUNT_MAX, parseDeckCount } from "./rules";

describe("parseDeckCount", () => {
  it("takes a whole number the captain typed, spaces trimmed", () => {
    expect(parseDeckCount("12")).toBe(12);
    expect(parseDeckCount(" 0 ")).toBe(0);
    expect(parseDeckCount(String(DECK_COUNT_MAX))).toBe(DECK_COUNT_MAX);
  });

  it("refuses an empty box rather than reading it as an empty boat", () => {
    expect(parseDeckCount("")).toBeNull();
    expect(parseDeckCount("   ")).toBeNull();
    expect(parseDeckCount(null)).toBeNull();
    expect(parseDeckCount(undefined)).toBeNull();
  });

  it("refuses anything that is not a whole head count", () => {
    for (const raw of ["-1", "1.5", "12a", "1e2", "0x10", "1000", "+3", "١٢"]) {
      expect(parseDeckCount(raw), raw).toBeNull();
    }
  });
});

describe("compareDeckCount", () => {
  it("says nothing when no count was entered", () => {
    expect(compareDeckCount(null, 12)).toBeNull();
  });

  it("matches when the deck and the screen agree", () => {
    expect(compareDeckCount(12, 12)).toEqual({ kind: "matches", counted: 12 });
    expect(compareDeckCount(0, 0)).toEqual({ kind: "matches", counted: 0 });
  });

  it("names both numbers when the deck counts fewer or more than the screen", () => {
    expect(compareDeckCount(11, 12)).toEqual({ kind: "differs", counted: 11, aboard: 12 });
    expect(compareDeckCount(13, 12)).toEqual({ kind: "differs", counted: 13, aboard: 12 });
    expect(compareDeckCount(4, 0)).toEqual({ kind: "differs", counted: 4, aboard: 0 });
  });
});
