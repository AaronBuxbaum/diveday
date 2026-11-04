import { describe, expect, it } from "vitest";
import { DECK_COUNT_MAX, isDeckCount, readDeckCount } from "./deck-count";

/**
 * **The deck count** (loop 5, row 1): the heads the captain counts on deck,
 * held against the manifest. A second, independent count that informs and
 * never gates. Adversarial first: the case this exists for is a full set of
 * marks over a boat that is one short.
 */
describe("readDeckCount", () => {
  it("says the marks are ahead of the deck when a mark sits on the wrong person", () => {
    // Twelve went out, twelve marked aboard, eleven heads on deck: the marks
    // read as a full boat, and only the deck count can say otherwise.
    const reading = readDeckCount({ counted: 11, expected: 12, markedAboard: 12, unmarked: [] });
    expect(reading).toEqual({
      agrees: false,
      counted: 11,
      expected: 12,
      markedAboard: 12,
      marksExceedCount: true,
      unmarked: [],
    });
  });

  it("names who has no mark when the deck is short", () => {
    const reading = readDeckCount({
      counted: 11,
      expected: 12,
      markedAboard: 11,
      unmarked: ["Omar Haddad"],
    });
    expect(reading.agrees).toBe(false);
    expect(reading.marksExceedCount).toBe(false);
    expect(reading.unmarked).toEqual(["Omar Haddad"]);
  });

  it("agrees when the deck matches the manifest, and still names a missing mark", () => {
    const reading = readDeckCount({
      counted: 12,
      expected: 12,
      markedAboard: 11,
      unmarked: ["Omar Haddad"],
    });
    expect(reading.agrees).toBe(true);
    expect(reading.unmarked).toEqual(["Omar Haddad"]);
  });

  it("does not agree when the deck holds more heads than the manifest", () => {
    const reading = readDeckCount({ counted: 13, expected: 12, markedAboard: 12, unmarked: [] });
    expect(reading.agrees).toBe(false);
    expect(reading.marksExceedCount).toBe(false);
  });

  it("agrees on an empty deck only when nobody is expected", () => {
    expect(readDeckCount({ counted: 0, expected: 0, markedAboard: 0, unmarked: [] }).agrees).toBe(
      true,
    );
    expect(
      readDeckCount({ counted: 0, expected: 1, markedAboard: 0, unmarked: ["A"] }).agrees,
    ).toBe(false);
  });
});

describe("isDeckCount", () => {
  it("takes a whole number from zero to the cap", () => {
    expect(isDeckCount(0)).toBe(true);
    expect(isDeckCount(12)).toBe(true);
    expect(isDeckCount(DECK_COUNT_MAX)).toBe(true);
  });

  it("refuses a fraction, a negative, a number past the cap and not-a-number", () => {
    expect(isDeckCount(-1)).toBe(false);
    expect(isDeckCount(1.5)).toBe(false);
    expect(isDeckCount(DECK_COUNT_MAX + 1)).toBe(false);
    expect(isDeckCount(Number.NaN)).toBe(false);
  });
});
