import { describe, expect, it } from "vitest";
import { type OpenSeatsInput, openSeatsDebrief } from "./open-seats";

const TZ = "America/New_York";
// An evening instant: 17:30 shop-local on 2026-08-04 (EDT, UTC-4).
const now = new Date("2026-08-04T21:30:00Z");
const HOUR = 60 * 60 * 1000;

function input(overrides: Partial<OpenSeatsInput> = {}): OpenSeatsInput {
  return {
    capacity: 12,
    booked: 8,
    // Sailed 07:30 local.
    startsAt: new Date("2026-08-04T11:30:00Z"),
    timeZone: TZ,
    lastBookingAt: null,
    dealSent: true,
    comparable: null,
    ...overrides,
  };
}

describe("openSeatsDebrief", () => {
  it("says nothing about a departure that filled", () => {
    expect(openSeatsDebrief(input({ booked: 12 }), now)).toBeNull();
    // Over-booked is still full, not negative seats.
    expect(openSeatsDebrief(input({ booked: 13 }), now)).toBeNull();
  });

  it("says nothing about a departure that has not sailed", () => {
    // Seats on a boat still ahead of the clock are seats, not a shortfall —
    // and the last-minute deal that has not gone out yet still can.
    const ahead = input({
      startsAt: new Date(now.getTime() + 2 * HOUR),
      dealSent: false,
      lastBookingAt: new Date(now.getTime() - HOUR),
    });
    expect(openSeatsDebrief(ahead, now)).toBeNull();
  });

  it("says nothing when there is no clause to make", () => {
    // Four seats open, nobody ever booked, and the deal did go out: the shop
    // already did the thing, so there is nothing here it can act on.
    expect(openSeatsDebrief(input({ lastBookingAt: null, dealSent: true }), now)).toBeNull();
  });

  it("carries each clause on its own", () => {
    const lastBooking = openSeatsDebrief(
      input({ lastBookingAt: new Date("2026-08-01T15:00:00Z") }),
      now,
    );
    expect(lastBooking).toEqual({
      openSeats: 4,
      lastBookingDaysOut: 3,
      dealSent: true,
      comparable: null,
    });

    const noDeal = openSeatsDebrief(input({ dealSent: false }), now);
    expect(noDeal).toEqual({
      openSeats: 4,
      lastBookingDaysOut: null,
      dealSent: false,
      comparable: null,
    });

    const comparable = {
      title: "Two-Tank Reef",
      startsAt: new Date("2026-07-28T11:30:00Z"),
      samePrice: true,
    };
    expect(openSeatsDebrief(input({ comparable }), now)?.comparable).toEqual(comparable);
  });

  it("counts the last booking in shop-local calendar days, not in elapsed hours", () => {
    // 11 p.m. the night before a 7:30 a.m. departure is **one day out**, which
    // is what a person means by it. Eight elapsed hours would say zero.
    const nightBefore = openSeatsDebrief(
      input({ lastBookingAt: new Date("2026-08-04T03:00:00Z") }),
      now,
    );
    expect(nightBefore?.lastBookingDaysOut).toBe(1);

    // The same morning reads as zero, and gets the sentence that says so.
    const sameDay = openSeatsDebrief(
      input({ lastBookingAt: new Date("2026-08-04T10:00:00Z") }),
      now,
    );
    expect(sameDay?.lastBookingDaysOut).toBe(0);
  });

  it("counts calendar days across a daylight-saving change", () => {
    // 2026-11-01 is the US fall-back: the span holds a 25-hour day, and an
    // hours-based count would come out half a day short.
    const debrief = openSeatsDebrief(
      input({
        startsAt: new Date("2026-11-03T12:30:00Z"), // 07:30 EST
        lastBookingAt: new Date("2026-10-30T11:30:00Z"), // 07:30 EDT
      }),
      new Date("2026-11-03T22:30:00Z"),
    );
    expect(debrief?.lastBookingDaysOut).toBe(4);
  });

  it("never carries a crew figure or a rank", () => {
    // #1207's own boundary, kept structurally: there is nothing on this shape
    // that a leaderboard could be built from.
    const debrief = openSeatsDebrief(input({ dealSent: false }), now);
    expect(Object.keys(debrief ?? {}).sort()).toEqual([
      "comparable",
      "dealSent",
      "lastBookingDaysOut",
      "openSeats",
    ]);
  });
});
