import { describe, expect, it } from "vitest";
import { blockerFixFor, totalBlockedDivers } from "./blockers";
import type { ReadinessBlocker } from "./readiness";

const ctx = {
  shopSlug: "reef-co",
  tripId: "trip-1",
  personId: "person-1",
  bookingId: "booking-1",
};

describe("blockerFixFor", () => {
  it("points card evidence at the diver's record", () => {
    const blockers: ReadinessBlocker[] = [{ code: "certification_pending", message: "..." }];
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Verify card",
      href: "/shop/reef-co/divers/person-1",
    });
  });

  it("points waiver work at the trip roster, anchored to the booking", () => {
    const blockers: ReadinessBlocker[] = [{ code: "waiver_not_sent", message: "..." }];
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Send waiver",
      href: "/shop/reef-co/trips/trip-1#booking-booking-1",
    });
  });

  it("resolves the worst blocker when several are present", () => {
    // medical_review (severity 0) outranks payment_due, and lives on the trip.
    const blockers: ReadinessBlocker[] = [
      { code: "payment_due", message: "..." },
      { code: "medical_review", message: "..." },
    ];
    expect(blockerFixFor(blockers, ctx)?.label).toBe("Review medical");
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
});
