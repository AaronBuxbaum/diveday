import { describe, expect, it } from "vitest";
import { DIVE_RECENCY_BANDS, type DiveRecencyBand, diveRecencyIsNotable } from "./dive-recency";

describe("diveRecencyIsNotable", () => {
  it("picks out the two answers a divemaster would read twice", () => {
    expect(diveRecencyIsNotable("over_five_years")).toBe(true);
    expect(diveRecencyIsNotable("never")).toBe(true);
  });

  it("leaves an ordinary lay-off alone, so the warning keeps meaning something", () => {
    // Two seasons off is the holiday diver's normal, and tinting it would tint
    // most of a Florida shop's winter roster.
    expect(diveRecencyIsNotable("one_to_five_years")).toBe(false);
    expect(diveRecencyIsNotable("within_a_year")).toBe(false);
    expect(diveRecencyIsNotable("this_season")).toBe(false);
  });

  it("never treats silence as a red flag", () => {
    // Every booking taken before the question existed is in this state, and an
    // absent answer is not a claim about anything.
    expect(diveRecencyIsNotable(null)).toBe(false);
    expect(diveRecencyIsNotable(undefined)).toBe(false);
  });

  it("has an answer for every band the column accepts", () => {
    // The guard that matters: a band added to the pgEnum and to the tuple, but
    // never considered here, would silently default to "not notable".
    for (const band of DIVE_RECENCY_BANDS) {
      expect(typeof diveRecencyIsNotable(band satisfies DiveRecencyBand)).toBe("boolean");
    }
    expect(DIVE_RECENCY_BANDS).toHaveLength(5);
  });
});
