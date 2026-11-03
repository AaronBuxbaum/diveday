import { describe, expect, it } from "vitest";
import {
  assembleDayCloseout,
  assembleEveningClose,
  type CloseoutRollCallGap,
  type CloseoutTripInput,
  dayLoadOut,
  tomorrowNoon,
} from "./closeout";

const TZ = "America/New_York";

/** A finished morning boat, its crew counted back: the ordinary shape. */
function trip(overrides: Partial<CloseoutTripInput> & { tripId: string }): CloseoutTripInput {
  const booked = overrides.booked ?? 8;
  return {
    title: "Two-Tank Reef",
    // Sailed 07:30 local, home 11:30 local.
    startsAt: new Date("2026-08-04T11:30:00Z"),
    endsAt: new Date("2026-08-04T15:30:00Z"),
    booked,
    sailed: booked,
    capacity: 12,
    plannedDives: 2,
    crew: [{ rollCall: { state: "boarded" } }, { rollCall: { state: "boarded" } }],
    recapShoutout: null,
    ...overrides,
  };
}

/** Tomorrow from tonight (fifth-loop ideas, item 2): a day's boats added together. */
describe("dayLoadOut", () => {
  it("adds every boat's tanks and the pieces the shop still offers", () => {
    expect(
      dayLoadOut([
        {
          tanks: { total: 22, air: 18, nitrox: 4 },
          lines: [
            { count: 6, notOffered: false },
            { count: 2, notOffered: true },
          ],
        },
        { tanks: { total: 20, air: 18, nitrox: 2 }, lines: [{ count: 9, notOffered: false }] },
      ]),
    ).toEqual({ departures: 2, tanks: { total: 42, air: 36, nitrox: 6 }, rentalPieces: 15 });
  });

  it("says nothing about a day with no departure", () => {
    expect(dayLoadOut([])).toBeNull();
  });
});

describe("tomorrowNoon", () => {
  it("is noon on the shop's next calendar day, not the server's", () => {
    // 11:30 PM in Key Largo on Oct 15 is already Oct 16 in UTC.
    const lateEvening = new Date("2026-10-16T03:30:00Z");
    expect(tomorrowNoon(lateEvening, "America/New_York").toISOString()).toBe(
      "2026-10-16T16:00:00.000Z",
    );
  });

  it("holds its hour across a daylight-saving change", () => {
    // The night of Nov 1, 2026: clocks fall back in New York.
    expect(tomorrowNoon(new Date("2026-11-01T02:00:00Z"), "America/New_York").toISOString()).toBe(
      "2026-11-01T17:00:00.000Z",
    );
  });
});

describe("assembleEveningClose: tomorrow's load-out", () => {
  const loadOut = { departures: 3, tanks: { total: 40, air: 34, nitrox: 6 }, rentalPieces: 12 };
  const departures = (trips: CloseoutTripInput[], at: Date, gaps: CloseoutRollCallGap[] = []) =>
    assembleDayCloseout({ trips, gaps, timeZone: TZ, now: at }).departures;

  it("speaks on a day with no departures, at any hour", () => {
    const morning = new Date("2026-08-04T13:00:00Z");
    const evening = assembleEveningClose(departures([], morning), morning, loadOut);
    expect(evening.closing).toBe(false);
    expect(evening.tomorrow).toEqual(loadOut);
  });

  it("waits for a night boat's scheduled return, and does not wait for its roll call", () => {
    const night = trip({
      tripId: "night",
      title: "Night Dive",
      // Sails 18:00 local, scheduled home 21:00 local.
      startsAt: new Date("2026-08-04T22:00:00Z"),
      endsAt: new Date("2026-08-05T01:00:00Z"),
    });
    const fivePm = new Date("2026-08-04T21:00:00Z");
    const atFive = assembleEveningClose(
      departures([trip({ tripId: "morning" }), night], fivePm),
      fivePm,
      loadOut,
    );
    expect(atFive.tomorrow).toBeNull();

    // A quarter past its scheduled return, the night boat is not yet settled:
    // the takings wait, tomorrow's count does not.
    const afterReturn = new Date("2026-08-05T01:15:00Z");
    const late = assembleEveningClose(
      departures([trip({ tripId: "morning" }), night], afterReturn, [
        { tripId: "night", reason: "after_dive_uncounted", diveNumber: 1, uncounted: 2 },
      ]),
      afterReturn,
      loadOut,
    );
    expect(late.closing).toBe(false);
    expect(late.tomorrow).toEqual(loadOut);
  });
});
