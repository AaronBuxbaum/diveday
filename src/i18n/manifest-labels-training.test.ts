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
      warnings: ["Instructor coverage for this training seat cannot be established"],
    });
    expect(
      trainingDiveLines(t, {
        trainingDive: { courseTitle: "Advanced Open Water", instructorAboard: true },
      }).warnings,
    ).toEqual([]);
  });

  it("says over the ratio when the instructor is aboard but the seat does not fit", () => {
    expect(
      trainingDiveLines(t, {
        trainingDive: {
          courseTitle: "Open Water Diver",
          instructorAboard: false,
          overRatio: true,
        },
      }).warnings,
    ).toEqual(["Over the instructor’s ratio for this course; move a student"]);
    const es = trainingDiveLines(staffTranslator("es-ES"), {
      trainingDive: { courseTitle: "X", instructorAboard: false, overRatio: true },
    });
    expect(es.warnings[0]).toMatch(/proporción/);
  });

  it("names who cleared a mark with forms unsigned, or says it without a name", () => {
    expect(
      trainingDiveLines(t, { trainingMarkCleared: { byName: "Ana Ruiz", reason: "forms_owed" } }),
    ).toEqual({
      fact: null,
      warnings: ["Training mark cleared by Ana Ruiz with course forms unsigned"],
    });
    expect(
      trainingDiveLines(t, { trainingMarkCleared: { byName: null, reason: "forms_owed" } })
        .warnings,
    ).toEqual(["Training mark cleared with course forms unsigned"]);
  });

  it("says when the mark cleared was one that no longer fit", () => {
    expect(
      trainingDiveLines(t, { trainingMarkCleared: { byName: "Ana Ruiz", reason: "mark_invalid" } })
        .warnings,
    ).toEqual(["Training mark cleared by Ana Ruiz after it stopped fitting its course seat"]);
  });

  it("says nothing for an ordinary seat", () => {
    expect(trainingDiveLines(t, {})).toEqual({ fact: null, warnings: [] });
  });
});
