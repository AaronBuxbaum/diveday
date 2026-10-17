import { describe, expect, it } from "vitest";
import type { StationClose } from "./closeout";
import { pastDayStationNotes } from "./past-day-notes";

const close = (overrides: Partial<StationClose> = {}): StationClose => ({
  tripId: "trip-1",
  title: "Morning Two-Tank",
  startsAt: new Date("2026-07-10T12:00:00Z"),
  endsAt: new Date("2026-07-10T16:00:00Z"),
  settled: true,
  status: "all_home",
  gapReason: null,
  diveNumber: 0,
  uncounted: 0,
  booked: 4,
  sailed: 4,
  back: 4,
  crewSailed: 2,
  crewAccountedFor: true,
  crewBack: 2,
  planChanges: [],
  recapSentAt: null,
  ended: true,
  ...overrides,
});

const base = { day: "2026-07-10", timeZone: "America/New_York" } as const;

describe("pastDayStationNotes", () => {
  it("says nothing over a day that closed clean, the same day", () => {
    expect(
      pastDayStationNotes({
        ...base,
        close: close(),
        closedAt: new Date("2026-07-10T17:00:00Z"),
        notBackDive: null,
      }),
    ).toEqual({ countedLaterOn: null, crewNotCounted: false, notBackDive: null });
  });

  it("names crew not counted when crew sailed and the count never took them", () => {
    const notes = pastDayStationNotes({
      ...base,
      close: close({ crewAccountedFor: false, crewBack: 0 }),
      closedAt: null,
      notBackDive: null,
    });
    expect(notes.crewNotCounted).toBe(true);
  });

  it("does not invent a crew gap on a boat that named no crew, or never left", () => {
    const noCrew = close({ crewSailed: 0, crewAccountedFor: false, crewBack: 0 });
    const stayed = close({ status: "not_departed", crewAccountedFor: false });
    for (const station of [noCrew, stayed]) {
      expect(
        pastDayStationNotes({ ...base, close: station, closedAt: null, notBackDive: null })
          .crewNotCounted,
      ).toBe(false);
    }
  });

  it("dates a count closed on a later shop day, in the shop's zone", () => {
    // 03:30 UTC on the 11th is still the 10th in New York.
    expect(
      pastDayStationNotes({
        ...base,
        close: close(),
        closedAt: new Date("2026-07-11T03:30:00Z"),
        notBackDive: null,
      }).countedLaterOn,
    ).toBeNull();
    expect(
      pastDayStationNotes({
        ...base,
        close: close(),
        closedAt: new Date("2026-07-12T14:00:00Z"),
        notBackDive: null,
      }).countedLaterOn,
    ).toBe("2026-07-12");
  });

  it("keeps a resolved not-back mark, and leaves a still-missing diver to the headline", () => {
    expect(
      pastDayStationNotes({ ...base, close: close(), closedAt: null, notBackDive: 2 }).notBackDive,
    ).toBe(2);
    expect(
      pastDayStationNotes({
        ...base,
        close: close({ status: "unreconciled", gapReason: "missing_diver", diveNumber: 2 }),
        closedAt: null,
        notBackDive: 2,
      }).notBackDive,
    ).toBeNull();
  });
});
