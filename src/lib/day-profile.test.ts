import { describe, expect, it } from "vitest";
import { dayProfileHasFacts, dayProfileRows, type PlannedDive } from "./day-profile";
import { DEFAULT_DOCK_DAY_RHYTHM, dockDayOffsets } from "./diver-planning";

/**
 * The day's profile, as a diver reads it before booking: how long each dive
 * runs, and how long they are out of the water between two of them.
 *
 * Every figure here is *planned*. The awkward cases are the point — one dive,
 * a rhythm that states no time, rows arriving out of order, and a course
 * weekend, each of which produced a confidently wrong sentence in the drafts
 * this test was written against.
 */

function dive(number: number, overrides: Partial<PlannedDive> = {}): PlannedDive {
  return { number, siteMaxDepthMeters: null, ...overrides };
}

describe("dayProfileRows", () => {
  it("puts the shop's interval between two dives and nothing after the last", () => {
    const rows = dayProfileRows({
      dives: [dive(1), dive(2)],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
    });
    expect(rows).toEqual([
      { kind: "dive", number: 1, siteMaxDepthMeters: null, bottomTimeMinutes: 45 },
      { kind: "surfaceInterval", afterDiveNumber: 1, minutes: 60 },
      { kind: "dive", number: 2, siteMaxDepthMeters: null, bottomTimeMinutes: 45 },
    ]);
  });

  it("says nothing about a surface interval on a one-tank day", () => {
    // The gap only exists because of the dive after it. A check-out dive that
    // printed an interval was the exact bug the dock-day rhythm was rebuilt to
    // stop (src/lib/diver-planning.ts).
    const rows = dayProfileRows({ dives: [dive(1)], rhythm: DEFAULT_DOCK_DAY_RHYTHM });
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.kind === "dive")).toBe(true);
  });

  it("reads a site's own bottom time over the shop's, per dive", () => {
    const rows = dayProfileRows({
      dives: [dive(1, { siteBottomTimeMinutes: 30 }), dive(2, { siteBottomTimeMinutes: null })],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
    });
    expect(rows.filter((row) => row.kind === "dive").map((row) => row.bottomTimeMinutes)).toEqual([
      30, 45,
    ]);
  });

  it("leaves a missing time null rather than printing a zero", () => {
    // A rhythm with no bottom time cannot be written through Settings
    // (`DOCK_DAY_LIMITS` floors it at 5), so this is an imported or hand-fixed
    // row. "0 minutes in the water" is worse than saying nothing.
    const rows = dayProfileRows({
      dives: [dive(1), dive(2)],
      rhythm: { ...DEFAULT_DOCK_DAY_RHYTHM, bottomTimeMinutes: 0, surfaceIntervalMinutes: 0 },
      diveMode: "shore",
    });
    expect(rows).toEqual([
      { kind: "dive", number: 1, siteMaxDepthMeters: null, bottomTimeMinutes: null },
      { kind: "dive", number: 2, siteMaxDepthMeters: null, bottomTimeMinutes: null },
    ]);
    expect(dayProfileHasFacts(rows)).toBe(false);
  });

  it("orders the dives itself, so a gap never lands after the wrong one", () => {
    const rows = dayProfileRows({
      dives: [dive(2, { siteBottomTimeMinutes: 30 }), dive(1, { siteBottomTimeMinutes: 50 })],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
    });
    expect(
      rows.map((row) => (row.kind === "dive" ? row.number : `after ${row.afterDiveNumber}`)),
    ).toEqual([1, "after 1", 2]);
    expect(rows[0]).toMatchObject({ bottomTimeMinutes: 50 });
  });

  it("widens the gap to a long run between sites, and never sums the two", () => {
    // The boat moves while the divers sit the interval out, so the window is
    // the longer of the two. Time out of the water is time out of the water,
    // whichever fact set its length.
    const rows = dayProfileRows({
      dives: [dive(1, { travelMinutes: 10 }), dive(2, { travelMinutes: 75 })],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
    });
    expect(rows[1]).toEqual({ kind: "surfaceInterval", afterDiveNumber: 1, minutes: 75 });
  });

  it("ignores the run between sites off a boat", () => {
    const rows = dayProfileRows({
      dives: [dive(1), dive(2, { travelMinutes: 75 })],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      diveMode: "shore",
    });
    expect(rows[1]).toEqual({ kind: "surfaceInterval", afterDiveNumber: 1, minutes: 60 });
  });

  it("never states an interval across a night", () => {
    // A course weekend meets on two days. The gap between Saturday's second
    // dive and Sunday's first is a night; calling it an hour on the surface
    // overstates the diver's rest, which is the one direction this figure must
    // never err (glossary, Surface interval).
    const rows = dayProfileRows({
      dives: [dive(1), dive(2), dive(3), dive(4)],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      dayCount: 2,
    });
    expect(
      rows.filter((row) => row.kind === "surfaceInterval").map((row) => row.afterDiveNumber),
    ).toEqual([1, 3]);
  });

  it("deals an odd dive count the way the dock day deals it", () => {
    // Three dives over two days is 2 + 1, so the only gap is inside day one.
    const rows = dayProfileRows({
      dives: [dive(1), dive(2), dive(3)],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      dayCount: 2,
    });
    expect(
      rows.filter((row) => row.kind === "surfaceInterval").map((row) => row.afterDiveNumber),
    ).toEqual([1]);
  });

  it("agrees with the dock-day timeline the diver reads after booking", () => {
    // The two surfaces read one calculation. If this drifts, a diver is told
    // one gap on the booking page and a different one on their own thread.
    const dives = [dive(1, { travelMinutes: 10 }), dive(2, { travelMinutes: 75 })];
    const rhythm = DEFAULT_DOCK_DAY_RHYTHM;
    const offsets = dockDayOffsets(
      rhythm,
      2,
      dives.map((entry) => entry.siteBottomTimeMinutes),
      dives.map((entry) => entry.travelMinutes),
    );
    const diveOne = offsets.find((beat) => beat.step === "dive" && beat.number === 1);
    const diveTwo = offsets.find((beat) => beat.step === "dive" && beat.number === 2);
    const outOfTheWater =
      (diveTwo?.minutesFromDeparture ?? 0) -
      ((diveOne?.minutesFromDeparture ?? 0) + rhythm.bottomTimeMinutes);
    const gap = dayProfileRows({ dives, rhythm })[1];
    expect(gap).toMatchObject({ kind: "surfaceInterval", minutes: outOfTheWater });
  });
});
