import { describe, expect, it } from "vitest";
import { mixedTrainingCandidates, type TrainingSession } from "./mixed-training-advisory";

const intro = { agency: "SSI", minimumCertificationLevel: null, isIntroCourse: true };
const entry = { agency: "PADI", minimumCertificationLevel: null, isIntroCourse: false };
const window = (start: number, end: number) => ({
  startsAt: new Date(start),
  endsAt: new Date(end),
});
const session = (id: string, course = entry): TrainingSession => ({
  id,
  course,
  windows: [window(100, 200)],
  instructorIds: ["instructor"],
  students: 1,
});

describe("possible mixed training", () => {
  it("warns in either enrollment direction, including another agency's intro", () => {
    expect(mixedTrainingCandidates(session("entry"), [session("intro", intro)])).toEqual(["intro"]);
    expect(mixedTrainingCandidates(session("intro", intro), [session("entry")])).toEqual(["entry"]);
    expect(mixedTrainingCandidates(session("intro", intro), [session("intro2", intro)])).toEqual([
      "intro2",
    ]);
  });

  it("needs an intro, a shared instructor and a student on the other session", () => {
    expect(mixedTrainingCandidates(session("one"), [session("two")])).toEqual([]);
    expect(
      mixedTrainingCandidates(session("intro", intro), [
        { ...session("other"), instructorIds: ["different"] },
      ]),
    ).toEqual([]);
    expect(
      mixedTrainingCandidates(session("intro", intro), [{ ...session("other"), students: 0 }]),
    ).toEqual([]);
  });

  it("only signals overlapping meeting windows; no warning does not establish boat capacity", () => {
    const target = { ...session("intro", intro), windows: [window(100, 200), window(400, 500)] };
    expect(
      mixedTrainingCandidates(target, [{ ...session("gap"), windows: [window(200, 400)] }]),
    ).toEqual([]);
    expect(
      mixedTrainingCandidates(target, [{ ...session("overlap"), windows: [window(450, 550)] }]),
    ).toEqual(["overlap"]);
  });

  it("warns once per other session even with multiple shared instructors", () => {
    const target = { ...session("intro", intro), instructorIds: ["a", "b"] };
    expect(
      mixedTrainingCandidates(target, [{ ...session("other"), instructorIds: ["a", "b"] }]),
    ).toEqual(["other"]);
  });
});
