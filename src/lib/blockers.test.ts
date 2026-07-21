import { describe, expect, it } from "vitest";
import { blockerFixFor, distinctBlockedDivers, totalBlockedDivers } from "./blockers";
import type { ReadinessBlocker } from "./readiness";

const ctx = {
  shopSlug: "reef-co",
  tripId: "trip-1",
  personId: "person-1",
  bookingId: "booking-1",
  fullName: "Priya Sharma",
};

describe("blockerFixFor", () => {
  it("points card evidence at the diver's record without pretending to act", () => {
    const blockers: ReadinessBlocker[] = [{ code: "certification_pending", message: "..." }];
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Open Priya’s record",
      href: "/shop/reef-co/divers/person-1",
      sendsWaiver: false,
      bookingId: "booking-1",
    });
  });

  it("sends waiver work in place, anchored to the booking (roster is the fallback)", () => {
    const blockers: ReadinessBlocker[] = [{ code: "waiver_not_sent", message: "..." }];
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Send waiver",
      href: "/shop/reef-co/trips/trip-1#booking-booking-1",
      sendsWaiver: true,
      bookingId: "booking-1",
    });
  });

  it("resolves the worst blocker when several are present", () => {
    // medical_review (severity 0) outranks payment_due, and lives on the roster.
    const blockers: ReadinessBlocker[] = [
      { code: "payment_due", message: "..." },
      { code: "medical_review", message: "..." },
    ];
    expect(blockerFixFor(blockers, ctx)?.label).toBe("Open roster");
  });

  it("returns null when there is nothing to fix", () => {
    expect(blockerFixFor([], ctx)).toBeNull();
  });
});

describe("totalBlockedDivers", () => {
  it("sums blocked divers across trip groups", () => {
    expect(
      totalBlockedDivers([
        {
          tripId: "a",
          title: "",
          startsAt: new Date(),
          courseTitle: null,
          booked: 3,
          ready: 1,
          divers: [{}, {}] as never,
        },
        {
          tripId: "b",
          title: "",
          startsAt: new Date(),
          courseTitle: null,
          booked: 2,
          ready: 2,
          divers: [],
        },
      ]),
    ).toBe(2);
  });

  it("counts a diver booked on two boats once for the headline", () => {
    const trips = [
      {
        tripId: "a",
        title: "",
        startsAt: new Date(),
        courseTitle: null,
        booked: 2,
        ready: 0,
        divers: [{ personId: "p1" }, { personId: "p2" }] as never,
      },
      {
        tripId: "b",
        title: "",
        startsAt: new Date(),
        courseTitle: null,
        booked: 1,
        ready: 0,
        divers: [{ personId: "p1" }] as never,
      },
    ];
    expect(totalBlockedDivers(trips)).toBe(3);
    expect(distinctBlockedDivers(trips)).toBe(2);
  });
});
