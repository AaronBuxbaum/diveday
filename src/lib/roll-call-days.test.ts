import { describe, expect, it } from "vitest";
import {
  type DayMark,
  manifestRollCallView,
  standingByDay,
  unaccountedSubjects,
} from "./roll-call-days";

const m = (
  subject: string,
  checkpoint: string,
  status: DayMark["status"],
  day: number,
): DayMark => ({ subject, checkpoint, status, day });
const states = (view: Map<string, DayMark>) =>
  Object.fromEntries(
    [...view].map(([key, mark]) => [key.replace("\u0000", "@"), `${mark.status}/${mark.day}`]),
  );

describe("roll-call results read day by day (#2557)", () => {
  it("compares dive numbers within a day: day one's back after dive 2 does not settle day two's dive 1", () => {
    expect(
      unaccountedSubjects([
        m("cara", "after_dive_1", "boarded", 0),
        m("cara", "after_dive_2", "boarded", 0),
        m("cara", "after_dive_1", "not_boarded", 1),
      ]),
    ).toEqual(new Set(["cara"]));
  });

  it("lets a day-two count settle a day-one missing diver", () => {
    expect(
      unaccountedSubjects([
        m("dan", "after_dive_2", "not_boarded", 0),
        m("dan", "departure", "boarded", 1),
        m("dan", "after_dive_1", "boarded", 1),
      ]),
    ).toEqual(new Set());
  });

  it("keeps a day-one missing diver on the manifest after the boundary until counted again", () => {
    const marks = [m("ben", "departure", "boarded", 0), m("ben", "after_dive_1", "not_boarded", 0)];
    expect(states(manifestRollCallView(marks, 1))).toEqual({ "ben@after_dive_1": "not_boarded/0" });
    expect(
      states(manifestRollCallView([...marks, m("ben", "after_dive_1", "boarded", 1)], 1)),
    ).toEqual({ "ben@after_dive_1": "boarded/1" });
  });

  it("lets a later-day undo take back a day-one mis-tap", () => {
    const marks = [
      m("ben", "after_dive_1", "not_boarded", 0),
      m("ben", "after_dive_1", "cleared", 1),
    ];
    expect(states(manifestRollCallView(marks, 1))).toEqual({});
    expect(unaccountedSubjects(marks)).toEqual(new Set());
    expect(standingByDay(marks).get(0)?.get("ben\u0000after_dive_1")?.status).toBe("cleared");
  });

  it("starts a later day empty for everyone accounted for", () => {
    const marks = [m("eve", "departure", "boarded", 0), m("eve", "after_dive_1", "boarded", 0)];
    expect(states(manifestRollCallView(marks, 1))).toEqual({});
    expect(states(manifestRollCallView(marks, 0))).toEqual({
      "eve@departure": "boarded/0",
      "eve@after_dive_1": "boarded/0",
    });
  });
});
