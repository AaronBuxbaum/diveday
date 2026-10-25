import { describe, expect, it } from "vitest";
import { assignmentCounts } from "./assignment-counts";

const row = (assigned: number, wanted: number) => ({
  assigned: Array.from({ length: assigned }, (_, i) => i),
  wanted: Array.from({ length: wanted }, (_, i) => i),
});

describe("assignmentCounts", () => {
  it("adds assigned and still-to-pick into what is needed, from the same rows", () => {
    expect(assignmentCounts([row(2, 3), row(0, 4)], [1, 2, 3, 4, 5, 6, 7])).toEqual({
      assigned: 2,
      needed: 9,
      missing: 7,
      proposed: 7,
    });
  });

  it("gives the button the summary's own number when every open piece has a proposal", () => {
    const picks = ["a", "b", "c"];
    const counts = assignmentCounts([row(1, 2), row(3, 1)], picks);
    expect(counts.proposed).toBe(counts.missing);
    // And the button sends exactly the picks it counts.
    expect(counts.proposed).toBe(picks.length);
  });

  it("leaves pieces with nothing free to a person: fewer proposed than missing", () => {
    const counts = assignmentCounts([row(0, 3)], ["a"]);
    expect(counts).toEqual({ assigned: 0, needed: 3, missing: 3, proposed: 1 });
  });

  it("says nothing is missing on a fully assigned departure", () => {
    expect(assignmentCounts([row(4, 0)], [])).toEqual({
      assigned: 4,
      needed: 4,
      missing: 0,
      proposed: 0,
    });
  });
});
