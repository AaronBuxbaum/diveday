import { describe, expect, it } from "vitest";
import { spineClearUnlessWindy, spineEntries, spineMoment } from "./spine-reading";

const at = (iso: string) => new Date(iso);

describe("spineEntries", () => {
  it("merges live and closing stations by time, a departure in one half only", () => {
    const spine = {
      stations: [
        { tripId: "noon", startsAt: at("2026-07-21T16:00:00Z") },
        { tripId: "dawn", startsAt: at("2026-07-21T11:00:00Z") },
      ],
    } as never;
    const close = {
      stations: [
        { tripId: "morning", startsAt: at("2026-07-21T13:00:00Z") },
        // Still live: the closing half never repeats it.
        { tripId: "noon", startsAt: at("2026-07-21T16:00:00Z") },
      ],
    } as never;
    const { liveTripIds, entries } = spineEntries(spine, close);
    expect([...liveTripIds].sort()).toEqual(["dawn", "noon"]);
    expect(
      entries.map((entry) =>
        entry.kind === "live" ? `live:${entry.station.tripId}` : `closing:${entry.close.tripId}`,
      ),
    ).toEqual(["live:dawn", "closing:morning", "live:noon"]);
  });

  it("reads the morning alone when there is no closing state", () => {
    const spine = { stations: [{ tripId: "dawn", startsAt: at("2026-07-21T11:00:00Z") }] } as never;
    expect(spineEntries(spine, undefined).entries).toHaveLength(1);
  });
});

describe("spineMoment", () => {
  it("lets the evening's all-home line outrank both morning moments", () => {
    expect(spineMoment({ allHome: true }, {}, {})).toEqual({
      allHomeLine: true,
      firstBookingMark: false,
      factOfScaleLine: false,
    });
  });

  it("puts the first booking ahead of the season's fact", () => {
    expect(spineMoment({ allHome: false }, {}, {})).toEqual({
      allHomeLine: false,
      firstBookingMark: true,
      factOfScaleLine: false,
    });
  });

  it("draws the season's fact when nothing above it holds", () => {
    expect(spineMoment(undefined, null, {})).toEqual({
      allHomeLine: false,
      firstBookingMark: false,
      factOfScaleLine: true,
    });
    expect(spineMoment(undefined, undefined, null).factOfScaleLine).toBe(false);
  });
});

describe("spineClearUnlessWindy", () => {
  const none = { allHomeLine: false, firstBookingMark: false, factOfScaleLine: false };
  const clearDay = { stations: [{ blocked: 0 }] };

  it("is never drawn under a coral moment", () => {
    for (const moment of [
      { ...none, allHomeLine: true },
      { ...none, firstBookingMark: true },
      { ...none, factOfScaleLine: true },
    ]) {
      expect(
        spineClearUnlessWindy(moment, { boatsClear: true, jobs: 0, blocked: 0 }, clearDay),
      ).toBe(false);
    }
  });

  it("follows the Needs you reading when it says the boats are clear", () => {
    expect(spineClearUnlessWindy(none, { boatsClear: true, jobs: 2, blocked: 0 }, clearDay)).toBe(
      true,
    );
  });

  it("with no job at all, stands only over stations with nobody blocked", () => {
    const idle = { boatsClear: false, jobs: 0, blocked: 0 };
    expect(spineClearUnlessWindy(none, idle, clearDay)).toBe(true);
    expect(spineClearUnlessWindy(none, idle, { stations: [] })).toBe(false);
    expect(spineClearUnlessWindy(none, idle, { stations: [{ blocked: 1 }] })).toBe(false);
    expect(spineClearUnlessWindy(none, { ...idle, blocked: 1 }, clearDay)).toBe(false);
    expect(spineClearUnlessWindy(none, { ...idle, jobs: 1 }, clearDay)).toBe(false);
  });
});
