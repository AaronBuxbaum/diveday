import { describe, expect, it } from "vitest";
import { bookingIdentityColumns, participantTypeRefusal } from "./booking-gates";

const charter = {
  courseId: null,
  priceCents: 15_000,
  snorkelerPriceCents: 4_000,
  riderPriceCents: null,
};
const course = { ...charter, courseId: "course-1" };

describe("participantTypeRefusal", () => {
  it("takes a non-diver on a course session only at a price the shop named, from either door", () => {
    // Issue #2226: the snorkeling spouse on the Open Water boat is a priced
    // seat like any other; an unpriced one is refused even to staff, because
    // on a course session an unpriced seat is how a student would be written
    // aboard as a rider.
    for (const actor of ["staff", "public"] as const) {
      expect(
        participantTypeRefusal({ actor, participantType: "snorkeler", trip: course }),
      ).toBeNull();
      expect(participantTypeRefusal({ actor, participantType: "rider", trip: course })).toBe(
        "participant_type_unavailable",
      );
      expect(participantTypeRefusal({ actor, participantType: "diver", trip: course })).toBeNull();
    }
  });

  it("sells the public only the types this departure prices", () => {
    expect(
      participantTypeRefusal({ actor: "public", participantType: "snorkeler", trip: charter }),
    ).toBeNull();
    expect(
      participantTypeRefusal({ actor: "public", participantType: "rider", trip: charter }),
    ).toBe("participant_type_unavailable");
  });

  it("lets staff seat an unpriced type on an ordinary departure (a partner who rides free)", () => {
    expect(
      participantTypeRefusal({ actor: "staff", participantType: "rider", trip: charter }),
    ).toBeNull();
  });
});

describe("bookingIdentityColumns", () => {
  const now = new Date("2031-06-14T09:00:00Z");

  it("stamps a held seat with what the staffer is shown", () => {
    expect(
      bookingIdentityColumns(true, { bookedAs: "Sam Reef", matchedBy: "shared_email" }, now),
    ).toEqual({
      identityUnconfirmedAt: now,
      identityBookedAs: "Sam Reef",
      identityMatchedBy: "shared_email",
      heldEmergencyContactName: null,
      heldEmergencyContactPhone: null,
    });
  });

  it("clears every column for a confirmed match, whatever claim rode along", () => {
    expect(
      bookingIdentityColumns(false, { bookedAs: "Sam Reef", matchedBy: "picked_name" }, now),
    ).toEqual({
      identityUnconfirmedAt: null,
      identityBookedAs: null,
      identityMatchedBy: null,
      heldEmergencyContactName: null,
      heldEmergencyContactPhone: null,
    });
  });
});

describe("bookingIdentityColumns without a claim (issue #3832)", () => {
  const now = new Date("2031-06-14T09:00:00Z");

  it("holds the seat but names nothing the staffer could be shown when no claim came with it", () => {
    expect(bookingIdentityColumns(true, null, now)).toEqual({
      identityUnconfirmedAt: now,
      identityBookedAs: null,
      identityMatchedBy: null,
      heldEmergencyContactName: null,
      heldEmergencyContactPhone: null,
    });
  });

  it("clears the flag and the claim together on a seat that is no longer held", () => {
    expect(
      bookingIdentityColumns(false, { bookedAs: "Sam Reef", matchedBy: "picked_name" }, now),
    ).toMatchObject({
      identityUnconfirmedAt: null,
      identityBookedAs: null,
      identityMatchedBy: null,
    });
  });
});
