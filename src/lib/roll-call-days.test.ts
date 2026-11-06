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

  describe("a cleared that takes back its own day's mark stays on its own day (#3981)", () => {
    const dayOneMissing = [
      m("ben", "departure", "boarded", 0),
      m("ben", "after_dive_1", "not_boarded", 0),
    ];

    it("keeps day one's missing diver missing when day two re-states them and undoes it", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "not_boarded", 1),
        m("ben", "after_dive_1", "cleared", 1),
      ];
      expect(standingByDay(marks).get(0)?.get("ben\u0000after_dive_1")?.status).toBe("not_boarded");
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("keeps day one's missing diver missing when a day-two count of them is undone", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "boarded", 1),
        m("ben", "after_dive_1", "cleared", 1),
      ];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("keeps day one's missing diver missing on day three after day two's undo", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "not_boarded", 1),
        m("ben", "after_dive_1", "cleared", 1),
      ];
      expect(states(manifestRollCallView(marks, 2))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("keeps day one's missing diver missing when a day-two undo is tapped twice", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "not_boarded", 1),
        m("ben", "after_dive_1", "cleared", 1),
        m("ben", "after_dive_1", "cleared", 1),
      ];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("keeps day one's missing diver missing after an undo at another checkpoint on day two", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_2", "not_boarded", 1),
        m("ben", "after_dive_2", "cleared", 1),
      ];
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("takes back only the newest carried day: day one's word survives a day-three undo of day two's", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "not_boarded", 1),
        m("ben", "after_dive_1", "cleared", 2),
      ];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 2))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("still lets an undo of the carried row, as the day's first mark there, take it back", () => {
      const marks = [...dayOneMissing, m("ben", "after_dive_1", "cleared", 1)];
      expect(unaccountedSubjects(marks)).toEqual(new Set());
      expect(states(manifestRollCallView(marks, 1))).toEqual({});
    });

    it("never lets a dock undo on day two reach back", () => {
      const marks = [...dayOneMissing, m("ben", "departure", "cleared", 1)];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });
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
