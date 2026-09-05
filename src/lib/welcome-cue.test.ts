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
        sharedAt: null,
        lastDivedAt: yearsAgo(5),
        tripEndsAt: TRIP_ENDS,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("reads a diver with no earlier departure as a first trip", () => {
    expect(
      welcomeCueFor({ sharedAt: NOW, lastDivedAt: null, tripEndsAt: TRIP_ENDS, now: NOW }),
    ).toEqual({ kind: "first_trip" });
  });

  it("counts the whole years a returning diver has been away", () => {
    expect(
      welcomeCueFor({
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
        sharedAt: NOW,
        lastDivedAt: yearsAgo(0.5),
        tripEndsAt: TRIP_ENDS,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("says nothing one year short of the gap, and speaks at it", () => {
    const short = welcomeCueFor({
      sharedAt: NOW,
      lastDivedAt: yearsAgo(WELCOME_GAP_YEARS - 1),
      tripEndsAt: TRIP_ENDS,
      now: NOW,
    });
    const met = welcomeCueFor({
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
        sharedAt: NOW,
        lastDivedAt: null,
        tripEndsAt: TRIP_ENDS,
        now: inBuffer,
      }),
    ).toEqual({ kind: "first_trip" });
    expect(
      welcomeCueFor({
        sharedAt: NOW,
        lastDivedAt: null,
        tripEndsAt: TRIP_ENDS,
        now: pastBuffer,
      }),
    ).toBeNull();
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
