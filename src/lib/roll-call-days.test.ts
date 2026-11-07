import { describe, expect, it } from "vitest";
import {
  backAboardNow,
  type DayMark,
  manifestRollCallView,
  notBackAboardSince,
  standingByDay,
  unaccountedSubjects,
} from "./roll-call-days";

const m = (
  subject: string,
  checkpoint: string,
  status: DayMark["status"],
  day: number,
  named: { id?: string; retracts?: string } = {},
): DayMark => ({ subject, checkpoint, status, day, ...named });
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

  it("lets a later-day undo that names it take back a day-one mis-tap", () => {
    const marks = [
      m("ben", "after_dive_1", "not_boarded", 0, { id: "d1" }),
      m("ben", "after_dive_1", "cleared", 1, { retracts: "d1" }),
    ];
    expect(states(manifestRollCallView(marks, 1))).toEqual({});
    expect(unaccountedSubjects(marks)).toEqual(new Set());
    expect(standingByDay(marks).get(0)?.get("ben\u0000after_dive_1")?.status).toBe("cleared");
  });

  describe("a cleared that takes back its own day's mark stays on its own day (#3981)", () => {
    const dayOneMissing = [
      m("ben", "departure", "boarded", 0),
      m("ben", "after_dive_1", "not_boarded", 0, { id: "d1" }),
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

    it("lets an undo of the carried row that names it take it back", () => {
      const marks = [...dayOneMissing, m("ben", "after_dive_1", "cleared", 1, { retracts: "d1" })];
      expect(unaccountedSubjects(marks)).toEqual(new Set());
      expect(states(manifestRollCallView(marks, 1))).toEqual({});
    });

    it("never lets a dock undo on day two reach back", () => {
      const marks = [...dayOneMissing, m("ben", "departure", "cleared", 1, { retracts: "d1" })];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });
  });

  describe("an undo reaches back only to the mark it names (#3995)", () => {
    const dayOneMissing = [
      m("ben", "departure", "boarded", 0),
      m("ben", "after_dive_1", "not_boarded", 0, { id: "d1" }),
    ];

    it("takes the carried row back after day two re-stated them and undid that", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "not_boarded", 1, { id: "d2" }),
        m("ben", "after_dive_1", "cleared", 1, { retracts: "d2" }),
        m("ben", "after_dive_1", "cleared", 1, { retracts: "d1" }),
      ];
      expect(unaccountedSubjects(marks)).toEqual(new Set());
      expect(states(manifestRollCallView(marks, 1))).toEqual({});
    });

    it("never reaches back with an undo that names nothing, even as the day's first mark", () => {
      const marks = [...dayOneMissing, m("ben", "after_dive_1", "cleared", 1)];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("never reaches back with a repeated undo of day two's own mark", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "not_boarded", 1, { id: "d2" }),
        m("ben", "after_dive_1", "cleared", 1, { retracts: "d2" }),
        m("ben", "after_dive_1", "cleared", 1, { retracts: "d2" }),
      ];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });

    it("never takes back another person's or another checkpoint's mark by its id", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_2", "cleared", 1, { retracts: "d1" }),
        m("cara", "after_dive_1", "cleared", 1, { retracts: "d1" }),
      ];
      expect(unaccountedSubjects(marks)).toEqual(new Set(["ben"]));
    });

    it("takes back day two's carried word on day three and leaves day one's", () => {
      const marks = [
        ...dayOneMissing,
        m("ben", "after_dive_1", "not_boarded", 1, { id: "d2" }),
        m("ben", "after_dive_1", "cleared", 2, { retracts: "d2" }),
      ];
      expect(states(manifestRollCallView(marks, 2))).toEqual({
        "ben@after_dive_1": "not_boarded/0",
      });
    });
  });

  describe("the missing-diver gate reads what the manifest shows (#4017)", () => {
    // One person's after-dive marks, oldest first, each with the time it was taken.
    const t = (minute: number) => new Date(Date.UTC(2026, 7, 1, 14, minute));
    const at = (
      checkpoint: string,
      status: DayMark["status"],
      day: number,
      minute: number,
      named: { id?: string; retracts?: string } = {},
    ) => ({ ...m("ben", checkpoint, status, day, named), occurredAt: t(minute) });
    const dayOneMissing = [at("after_dive_1", "not_boarded", 0, 0, { id: "d1" })];

    it("keeps day one's missing diver missing after a day-two count of them is undone", () => {
      const marks = [
        ...dayOneMissing,
        at("after_dive_1", "boarded", 1, 10, { id: "b2" }),
        at("after_dive_1", "cleared", 1, 11, { retracts: "b2" }),
      ];
      expect(notBackAboardSince(marks, 1)).toEqual(t(0));
      expect(backAboardNow(marks, 1)).toBe(false);
    });

    it("keeps them missing after a day-two undo that names nothing, or another checkpoint's mark", () => {
      for (const undo of [
        at("after_dive_1", "cleared", 1, 10),
        at("after_dive_2", "cleared", 1, 10, { retracts: "d1" }),
        at("departure", "cleared", 1, 10, { retracts: "d1" }),
      ]) {
        expect(notBackAboardSince([...dayOneMissing, undo], 1)).toEqual(t(0));
      }
    });

    it("dates the disappearance from day one when day two re-states it, before and after an undo", () => {
      const restated = [...dayOneMissing, at("after_dive_1", "not_boarded", 1, 10, { id: "d2" })];
      expect(notBackAboardSince(restated, 1)).toEqual(t(0));
      const undoneAndRestated = [
        ...restated,
        at("after_dive_1", "cleared", 1, 11, { retracts: "d2" }),
        at("after_dive_1", "not_boarded", 1, 12),
      ];
      expect(notBackAboardSince(undoneAndRestated, 1)).toEqual(t(0));
      expect(notBackAboardSince(undoneAndRestated, 2)).toEqual(t(0));
    });

    it("dates it from the first tap of an unbroken run, not an offline copy synced later", () => {
      const marks = [...dayOneMissing, at("after_dive_1", "not_boarded", 0, 7)];
      expect(notBackAboardSince(marks, 0)).toEqual(t(0));
      expect(notBackAboardSince(marks, 1)).toEqual(t(0));
    });

    it("lets go only when the manifest does: a named undo of the carried mark, or a later-day count", () => {
      expect(
        notBackAboardSince(
          [...dayOneMissing, at("after_dive_1", "cleared", 1, 10, { retracts: "d1" })],
          1,
        ),
      ).toBeNull();
      const counted = [...dayOneMissing, at("after_dive_2", "boarded", 1, 10)];
      expect(notBackAboardSince(counted, 1)).toBeNull();
      expect(backAboardNow(counted, 1)).toBe(true);
    });

    it("keeps today's rule: a missing mark today stands beside a later dive's back aboard", () => {
      const marks = [...dayOneMissing, at("after_dive_2", "boarded", 0, 30)];
      expect(notBackAboardSince(marks, 0)).toEqual(t(0));
      expect(backAboardNow(marks, 0)).toBe(false);
    });

    it("never reads an undo as back aboard, and never reads a mark taken back on its own day", () => {
      const undone = [...dayOneMissing, at("after_dive_1", "cleared", 0, 1, { retracts: "d1" })];
      expect(notBackAboardSince(undone, 0)).toBeNull();
      expect(backAboardNow(undone, 0)).toBe(false);
      expect(backAboardNow([], 0)).toBe(false);
    });

    it("lets a mark from a day the server has not reached add red but settle nothing", () => {
      expect(notBackAboardSince([at("after_dive_1", "not_boarded", 1, 0)], 0)).toEqual(t(0));
      for (const ahead of [
        at("after_dive_2", "boarded", 1, 30),
        at("after_dive_1", "boarded", 1, 30),
        at("after_dive_1", "cleared", 1, 30, { retracts: "d1" }),
      ]) {
        const marks = [...dayOneMissing, ahead];
        expect(notBackAboardSince(marks, 0)).toEqual(t(0));
        expect(backAboardNow(marks, 0)).toBe(false);
      }
    });

    it("never reads the dock's 'not boarded' as missing", () => {
      expect(notBackAboardSince([at("departure", "not_boarded", 0, 0)], 0)).toBeNull();
      expect(notBackAboardSince([at("departure", "not_boarded", 0, 0)], 1)).toBeNull();
    });
  });

  describe("a later day settles a carried miss only at the dock or at its checkpoint or later (#4056)", () => {
    // Maya is not back after dive 2 on day one and searched for overnight.
    const t = (minute: number) => new Date(Date.UTC(2026, 7, 1, 14, minute));
    const at = (checkpoint: string, status: DayMark["status"], day: number, minute: number) => ({
      ...m("maya", checkpoint, status, day),
      occurredAt: t(minute),
    });
    const dayOne = [
      at("departure", "boarded", 0, 0),
      at("after_dive_1", "boarded", 0, 10),
      at("after_dive_2", "not_boarded", 0, 20),
    ];
    const missing = { "maya@after_dive_2": "not_boarded/0" };

    it("keeps her missing on day two after a mis-tap of back aboard after dive 1", () => {
      const marks = [...dayOne, at("after_dive_1", "boarded", 1, 30)];
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        ...missing,
        "maya@after_dive_1": "boarded/1",
      });
      expect(unaccountedSubjects(marks)).toEqual(new Set(["maya"]));
      expect(notBackAboardSince(marks, 1)).toEqual(t(20));
      expect(backAboardNow(marks, 1)).toBe(false);
      expect(states(manifestRollCallView(marks, 2))).toEqual(missing);
    });

    it("lets a count filed on a day the server has not reached settle nothing, on the manifest as at the gate", () => {
      for (const checkpoint of ["departure", "after_dive_2"]) {
        const marks = [...dayOne, at(checkpoint, "boarded", 2, 30)];
        expect(states(manifestRollCallView(marks, 1)), checkpoint).toEqual(missing);
        expect(notBackAboardSince(marks, 1), checkpoint).toEqual(t(20));
        expect(backAboardNow(marks, 1), checkpoint).toBe(false);
      }
    });

    it("settles her on day two by a dock count, or a count after dive 2 or a later dive", () => {
      for (const counted of [
        at("departure", "boarded", 1, 30),
        at("after_dive_2", "boarded", 1, 30),
        at("after_dive_3", "boarded", 1, 30),
      ]) {
        const marks = [...dayOne, at("after_dive_1", "boarded", 1, 25), counted];
        const shown = states(manifestRollCallView(marks, 1));
        expect(shown["maya@after_dive_2"], counted.checkpoint).not.toBe("not_boarded/0");
        expect(unaccountedSubjects(marks), counted.checkpoint).toEqual(new Set());
        expect(notBackAboardSince(marks, 1), counted.checkpoint).toBeNull();
      }
    });

    it("lets the Found gate read day two's dock count as back aboard, as the manifest does", () => {
      const marks = [...dayOne, at("departure", "boarded", 1, 30)];
      expect(states(manifestRollCallView(marks, 1))).toEqual({ "maya@departure": "boarded/1" });
      expect(backAboardNow(marks, 1)).toBe(true);
    });

    it("never reads a dock count on the day of the miss as back aboard, even after an undo", () => {
      const undone = [
        ...dayOne.slice(0, 2),
        { ...at("after_dive_2", "not_boarded", 0, 20), id: "d1" },
        { ...at("after_dive_2", "cleared", 0, 21), retracts: "d1" },
        at("departure", "boarded", 0, 22),
      ];
      expect(notBackAboardSince(undone, 0)).toBeNull();
      expect(backAboardNow(undone, 0)).toBe(false);
      expect(backAboardNow([...dayOne, at("departure", "boarded", 0, 30)], 0)).toBe(false);
      expect(backAboardNow([at("departure", "boarded", 0, 0)], 0)).toBe(false);
    });

    it("keeps a dock 'not boarded' on day two from settling or raising anything", () => {
      const marks = [...dayOne, at("departure", "not_boarded", 1, 30)];
      expect(states(manifestRollCallView(marks, 1))).toEqual({
        ...missing,
        "maya@departure": "not_boarded/1",
      });
      expect(notBackAboardSince(marks, 1)).toEqual(t(20));
      expect(backAboardNow(marks, 1)).toBe(false);
    });

    it("lets a dock count that is undone on day two settle nothing", () => {
      const marks = [
        ...dayOne,
        at("departure", "boarded", 1, 30),
        at("departure", "cleared", 1, 31),
      ];
      expect(states(manifestRollCallView(marks, 1))).toEqual(missing);
      expect(notBackAboardSince(marks, 1)).toEqual(t(20));
      expect(backAboardNow(marks, 1)).toBe(false);
    });

    it("agrees with the manifest on every day-two tap: red there is missing at the gate", () => {
      for (const checkpoint of ["departure", "after_dive_1", "after_dive_2", "after_dive_3"]) {
        for (const status of ["boarded", "not_boarded", "cleared"] as const) {
          const marks = [...dayOne, at(checkpoint, status, 1, 30)];
          const red = [...manifestRollCallView(marks, 1).values()].some(
            (mark) => mark.status === "not_boarded" && mark.checkpoint !== "departure",
          );
          const label = `${checkpoint} ${status}`;
          expect(notBackAboardSince(marks, 1) !== null, label).toBe(red);
          expect(unaccountedSubjects(marks).has("maya"), label).toBe(red);
          if (red) expect(backAboardNow(marks, 1), label).toBe(false);
        }
      }
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
