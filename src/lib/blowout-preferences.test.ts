import { describe, expect, it } from "vitest";
import { parseBlowoutPreferences } from "./blowout-preferences";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
describe("weather alternative form input", () => {
  it("preserves an empty choice and deduplicates explicit ids", () => {
    expect(parseBlowoutPreferences([])).toEqual([]);
    expect(parseBlowoutPreferences([id(1), id(1), id(2)])).toEqual([id(1), id(2)]);
  });
  it("rejects malformed or oversized choices instead of canceling with different options", () => {
    expect(parseBlowoutPreferences(["bad"])).toBeNull();
    expect(parseBlowoutPreferences([{}])).toBeNull();
    expect(parseBlowoutPreferences([id(1), id(2), id(3), id(4)])).toBeNull();
  });
});
