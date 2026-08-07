import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import {
  annotateAlsoOn,
  type BlockerQueueTrip,
  blockerFixFor,
  distinctBlockedDivers,
} from "./blockers";
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
    const blockers: ReadinessBlocker[] = [{ code: "certification_pending" }];
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Open Priya’s record",
      href: "/shop/reef-co/divers/person-1",
      sendsWaiver: false,
      bookingId: "booking-1",
    });
  });

  it("sends waiver work in place, anchored to the booking (roster is the fallback)", () => {
    const blockers: ReadinessBlocker[] = [{ code: "waiver_not_sent" }];
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Send waiver",
      href: "/shop/reef-co/trips/trip-1/guests#booking-booking-1",
      sendsWaiver: true,
      bookingId: "booking-1",
    });
  });

  it("resolves the worst blocker when several are present", () => {
    // medical_review (severity 0) outranks payment_due, and lives on the roster.
    const blockers: ReadinessBlocker[] = [{ code: "payment_due" }, { code: "medical_review" }];
    expect(blockerFixFor(blockers, ctx)?.label).toBe("Open roster");
  });

  it("returns null when there is nothing to fix", () => {
    expect(blockerFixFor([], ctx)).toBeNull();
  });
});

describe("distinctBlockedDivers", () => {
  it("counts a diver booked on two boats once for the headline", () => {
    const trips = [
      {
        tripId: "a",
        title: "",
        startsAt: nowDate(),
        courseTitle: null,
        booked: 2,
        ready: 0,
        divers: [{ personId: "p1" }, { personId: "p2" }] as never,
        urgency: "now" as const,
      },
      {
        tripId: "b",
        title: "",
        startsAt: nowDate(),
        courseTitle: null,
        booked: 1,
        ready: 0,
        divers: [{ personId: "p1" }] as never,
        urgency: "now" as const,
      },
    ];
    expect(distinctBlockedDivers(trips)).toBe(2);
  });
});

describe("annotateAlsoOn", () => {
  const trip = (tripId: string, title: string, personIds: string[]): BlockerQueueTrip => ({
    tripId,
    title,
    startsAt: nowDate(),
    courseTitle: null,
    booked: personIds.length,
    ready: 0,
    divers: personIds.map((personId) => ({ personId, alsoOn: [] }) as never),
    urgency: "now",
  });

  it("ties a repeat diver's rows together with the other trip titles", () => {
    const trips = [
      trip("a", "Wreck Trip", ["p1", "p2"]),
      trip("b", "Reef Dive", ["p1"]),
      trip("c", "Night Dive", ["p1"]),
    ];
    annotateAlsoOn(trips);
    // p1 is on all three: each row lists the other two.
    expect(trips[0].divers[0].alsoOn).toEqual(["Reef Dive", "Night Dive"]);
    expect(trips[1].divers[0].alsoOn).toEqual(["Wreck Trip", "Night Dive"]);
    // p2 is only on one boat — no cross-reference.
    expect(trips[0].divers[1].alsoOn).toEqual([]);
  });

  it("dedupes by trip identity, not title, so same-named departures stay distinct", () => {
    const trips = [trip("a", "Two-Tank Reef", ["p1"]), trip("b", "Two-Tank Reef", ["p1"])];
    annotateAlsoOn(trips);
    expect(trips[0].divers[0].alsoOn).toEqual(["Two-Tank Reef"]);
    expect(trips[1].divers[0].alsoOn).toEqual(["Two-Tank Reef"]);
  });
});
