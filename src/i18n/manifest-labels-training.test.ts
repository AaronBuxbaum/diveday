import { describe, expect, it } from "vitest";
import { trainingDiveLines } from "./manifest-labels";
import { staffTranslator } from "./staff-messages";

const t = staffTranslator("en-US");

describe("a training dive's manifest lines (issue #2275)", () => {
  it("names the course, and warns when no instructor is on the crew", () => {
    expect(
      trainingDiveLines(t, {
        trainingDive: { courseTitle: "Advanced Open Water", instructorAboard: false },
      }),
    ).toEqual({
      fact: "Training dive for Advanced Open Water",
      warnings: ["No instructor is on this boat’s crew"],
    });
    expect(
      trainingDiveLines(t, {
        trainingDive: { courseTitle: "Advanced Open Water", instructorAboard: true },
      }).warnings,
    ).toEqual([]);
  });

  it("names who cleared a mark with forms unsigned, or says it without a name", () => {
    expect(trainingDiveLines(t, { trainingMarkCleared: { byName: "Ana Ruiz" } })).toEqual({
      fact: null,
      warnings: ["Training mark cleared by Ana Ruiz with course forms unsigned"],
    });
    expect(trainingDiveLines(t, { trainingMarkCleared: { byName: null } }).warnings).toEqual([
      "Training mark cleared with course forms unsigned",
    ]);
  });

  it("says nothing for an ordinary seat", () => {
    expect(trainingDiveLines(t, {})).toEqual({ fact: null, warnings: [] });
  });
});
