import { describe, expect, it } from "vitest";
import { isUsualCrew, mostCommonCrew } from "./usual-crew";

/** A departure, reduced to the only field the vote reads. */
const on = (...crew: string[]) => ({ crew });

describe("mostCommonCrew", () => {
  it("names the signature that covers most of the window", () => {
    // Four of five. Over the threshold on both halves.
    expect(
      mostCommonCrew([
        on("Keiko", "Sal"),
        on("Keiko", "Sal"),
        on("Keiko", "Sal"),
        on("Keiko", "Sal"),
        on("Marcus"),
      ]),
    ).toEqual(["Keiko", "Sal"]);
  });

  it("refuses a signature that appears fewer than three times", () => {
    // Two of three is a majority and still not a habit. A week with three
    // departures has nothing for a row to be an exception to, so every row
    // keeps its line.
    expect(mostCommonCrew([on("Keiko", "Sal"), on("Keiko", "Sal"), on("Marcus")])).toBeNull();
  });

  it("refuses a signature that is not more than half the window", () => {
    // Three occurrences, but three of six is not a majority — exactly half
    // fails, because a board split down the middle has two habits and
    // therefore none.
    expect(
      mostCommonCrew([
        on("Keiko", "Sal"),
        on("Keiko", "Sal"),
        on("Keiko", "Sal"),
        on("Marcus"),
        on("Dana"),
        on("Priya"),
      ]),
    ).toBeNull();
  });

  it("counts a different order as a different crew", () => {
    // The order is the shop's own — lead first — so it is a fact about the
    // assignment rather than an artefact of the query.
    expect(
      mostCommonCrew([
        on("Keiko", "Sal"),
        on("Keiko", "Sal"),
        on("Sal", "Keiko"),
        on("Sal", "Keiko"),
      ]),
    ).toBeNull();
  });

  it("never lets an empty crew win the vote", () => {
    // "Nobody yet" is the gap the line exists to show. If it could become the
    // usual, an understaffed week would go quiet exactly when it should not.
    expect(mostCommonCrew([on(), on(), on(), on(), on("Keiko")])).toBeNull();
  });

  it("does not count empty crews toward the majority either", () => {
    // Three assignments out of five rows, two of which are unstaffed: the
    // habit is real and the unstaffed rows are the exception, so it stands.
    expect(mostCommonCrew([on("Keiko"), on("Keiko"), on("Keiko"), on(), on()])).toEqual(["Keiko"]);
  });

  it("has no answer for an empty board", () => {
    expect(mostCommonCrew([])).toBeNull();
  });

  it("copies the signature it returns", () => {
    // The caller holds this across a render; handing back the caller's own
    // array would let a later mutation of one departure rewrite the answer.
    const departure = { crew: ["Keiko"] };
    const usual = mostCommonCrew([departure, { crew: ["Keiko"] }, { crew: ["Keiko"] }]);
    departure.crew.push("Sal");
    expect(usual).toEqual(["Keiko"]);
  });
});

describe("isUsualCrew", () => {
  it("is false when the board has no usual crew", () => {
    // Every row prints its line in that case, which is the quiet default the
    // caller depends on.
    expect(isUsualCrew(["Keiko"], null)).toBe(false);
  });

  it("matches the same names in the same order", () => {
    expect(isUsualCrew(["Keiko", "Sal"], ["Keiko", "Sal"])).toBe(true);
  });

  it("does not match the same names in a different order", () => {
    expect(isUsualCrew(["Sal", "Keiko"], ["Keiko", "Sal"])).toBe(false);
  });

  it("does not match a subset or a superset", () => {
    expect(isUsualCrew(["Keiko"], ["Keiko", "Sal"])).toBe(false);
    expect(isUsualCrew(["Keiko", "Sal", "Dana"], ["Keiko", "Sal"])).toBe(false);
  });

  it("does not let an unstaffed departure pass as usual", () => {
    // The one case that would hide a gap: an empty crew must print its line
    // whatever the board's habit is.
    expect(isUsualCrew([], ["Keiko", "Sal"])).toBe(false);
  });
});
