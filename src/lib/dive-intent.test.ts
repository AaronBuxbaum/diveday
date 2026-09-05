import { describe, expect, it } from "vitest";
import { DIVE_INTENTS, diveIntentTally, parseDiveIntent } from "./dive-intent";

describe("diveIntentTally", () => {
  it("counts nothing for an empty roster", () => {
    expect(diveIntentTally([])).toEqual([]);
  });

  it("never counts a diver who did not say", () => {
    // Silence is not an answer. A boat where nobody answered reads as a boat
    // with nothing to say about intent, not as five noughts.
    expect(diveIntentTally([null, undefined, null])).toEqual([]);
    expect(diveIntentTally([null, "a_wreck", undefined])).toEqual([
      { intent: "a_wreck", count: 1 },
    ]);
  });

  it("drops the answers nobody gave", () => {
    const tally = diveIntentTally(["good_day", "good_day"]);
    expect(tally).toEqual([{ intent: "good_day", count: 2 }]);
  });

  it("always reads in the offered order, whatever order the answers arrived in", () => {
    // The sentence a divemaster reads must not reshuffle between two renders of
    // the same boat, so the order is the tuple's and never the counts'.
    const arrivals = diveIntentTally(["good_day", "easing_back", "small_life", "good_day"]);
    expect(arrivals.map(({ intent }) => intent)).toEqual(["easing_back", "small_life", "good_day"]);
    const reversed = diveIntentTally(["small_life", "good_day", "good_day", "easing_back"]);
    expect(reversed).toEqual(arrivals);
  });
});

describe("parseDiveIntent", () => {
  it("takes the five and refuses everything else", () => {
    for (const intent of DIVE_INTENTS) expect(parseDiveIntent(intent)).toBe(intent);
    // An anonymous form's junk field is "not said", never a refusal: a hand-
    // crafted post must not be able to cost somebody a seat.
    for (const junk of ["", "EASING_BACK", "wreck", 3, null, undefined, {}]) {
      expect(parseDiveIntent(junk)).toBeNull();
    }
  });
});
