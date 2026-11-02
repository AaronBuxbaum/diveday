import { describe, expect, it } from "vitest";
import { DEPARTURE_BUFFER_MS } from "./trips";
import { offerableWelcomeCue, WELCOME_GAP_YEARS, welcomeCueFor } from "./welcome-cue";

const NOW = new Date("2026-07-21T13:30:00.000Z");
const TRIP_ENDS = new Date("2026-07-21T14:30:00.000Z");
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** `years` years before `NOW`, plus a day so the floor lands where it reads. */
function yearsAgo(years: number): Date {
  return new Date(NOW.getTime() - years * YEAR_MS - 24 * 60 * 60 * 1000);
}

describe("welcomeCueFor", () => {
  it("says nothing without consent, however long the gap", () => {
    expect(
      welcomeCueFor({
        diveDayCount: null,
        sharedAt: null,
        lastDivedAt: yearsAgo(5),
        tripEndsAt: TRIP_ENDS,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("reads a diver with no earlier departure as a first trip", () => {
    expect(
      welcomeCueFor({
        diveDayCount: null,
        sharedAt: NOW,
        lastDivedAt: null,
        tripEndsAt: TRIP_ENDS,
        now: NOW,
      }),
    ).toEqual({ kind: "first_trip" });
  });

  it("marks a first seat that is not a dive, so its words can say so", () => {
    expect(
      welcomeCueFor({
        diveDayCount: null,
        sharedAt: NOW,
        lastDivedAt: null,
        nonDiver: true,
        tripEndsAt: TRIP_ENDS,
        now: NOW,
      }),
    ).toEqual({ kind: "first_trip", nonDiver: true });
  });

  it("counts the whole years a returning diver has been away", () => {
    expect(
      welcomeCueFor({
        diveDayCount: null,
        sharedAt: NOW,
        lastDivedAt: yearsAgo(3),
        tripEndsAt: TRIP_ENDS,
        now: NOW,
      }),
    ).toEqual({ kind: "returning", years: 3 });
  });

  it("says nothing about a diver who was here six months ago", () => {
    expect(
      welcomeCueFor({
        diveDayCount: null,
        sharedAt: NOW,
        lastDivedAt: yearsAgo(0.5),
        tripEndsAt: TRIP_ENDS,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("says nothing one year short of the gap, and speaks at it", () => {
    const short = welcomeCueFor({
      diveDayCount: null,
      sharedAt: NOW,
      lastDivedAt: yearsAgo(WELCOME_GAP_YEARS - 1),
      tripEndsAt: TRIP_ENDS,
      now: NOW,
    });
    const met = welcomeCueFor({
      diveDayCount: null,
      sharedAt: NOW,
      lastDivedAt: yearsAgo(WELCOME_GAP_YEARS),
      tripEndsAt: TRIP_ENDS,
      now: NOW,
    });
    expect(short).toBeNull();
    expect(met).toEqual({ kind: "returning", years: WELCOME_GAP_YEARS });
  });

  it("still speaks 59 minutes after the boat was due back, and stops at 61", () => {
    const inBuffer = new Date(TRIP_ENDS.getTime() + DEPARTURE_BUFFER_MS - 60_000);
    const pastBuffer = new Date(TRIP_ENDS.getTime() + DEPARTURE_BUFFER_MS + 60_000);
    expect(
      welcomeCueFor({
        diveDayCount: null,
        sharedAt: NOW,
        lastDivedAt: null,
        tripEndsAt: TRIP_ENDS,
        now: inBuffer,
      }),
    ).toEqual({ kind: "first_trip" });
    expect(
      welcomeCueFor({
        diveDayCount: null,
        sharedAt: NOW,
        lastDivedAt: null,
        tripEndsAt: TRIP_ENDS,
        now: pastBuffer,
      }),
    ).toBeNull();
  });
});

describe("a regular's milestone dive day (H-20261014-boat-count-milestones)", () => {
  const consented = { sharedAt: NOW, lastDivedAt: yearsAgo(0), tripEndsAt: TRIP_ENDS, now: NOW };

  it("is said on the 10th, 25th, 50th and 100th dive day and on no other", () => {
    for (const count of [10, 25, 50, 100]) {
      expect(welcomeCueFor({ ...consented, diveDayCount: count })).toEqual({
        kind: "milestone",
        count,
      });
    }
    for (const count of [1, 2, 9, 11, 24, 26, 99, 101]) {
      expect(welcomeCueFor({ ...consented, diveDayCount: count })?.kind).not.toBe("milestone");
    }
  });

  it("is never said without consent, nor on a seat that is not a dive", () => {
    expect(welcomeCueFor({ ...consented, sharedAt: null, diveDayCount: 25 })).toBeNull();
    expect(welcomeCueFor({ ...consented, nonDiver: true, diveDayCount: 25 })?.kind).not.toBe(
      "milestone",
    );
  });

  it("outranks a long gap, and stops when the boat is home", () => {
    expect(welcomeCueFor({ ...consented, lastDivedAt: yearsAgo(3), diveDayCount: 50 })).toEqual({
      kind: "milestone",
      count: 50,
    });
    const home = new Date(TRIP_ENDS.getTime() + DEPARTURE_BUFFER_MS + 60_000);
    expect(welcomeCueFor({ ...consented, now: home, diveDayCount: 25 })).toBeNull();
  });
});

describe("offerableWelcomeCue", () => {
  it("offers the question to a diver who has not consented", () => {
    expect(offerableWelcomeCue({ lastDivedAt: null, tripEndsAt: TRIP_ENDS, now: NOW })).toEqual({
      kind: "first_trip",
    });
  });

  it("offers nothing once the boat is home, so the question stops being asked", () => {
    expect(
      offerableWelcomeCue({
        lastDivedAt: null,
        tripEndsAt: TRIP_ENDS,
        now: new Date(TRIP_ENDS.getTime() + DEPARTURE_BUFFER_MS + 60_000),
      }),
    ).toBeNull();
  });
});
