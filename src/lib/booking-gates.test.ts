import { describe, expect, it } from "vitest";
import type { Certification } from "@/db/schema";
import {
  bookingIdentityColumns,
  courseEnrollmentRefusal,
  courseRatioRefusal,
  participantTypeRefusal,
} from "./booking-gates";

const card = (level: Certification["level"], status: Certification["status"]) =>
  ({ level, status }) as Certification;

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

describe("courseEnrollmentRefusal", () => {
  const needsOpenWater = { minimumCertificationLevel: "open_water" as const, minimumAge: null };
  const tenAndUp = { minimumCertificationLevel: null, minimumAge: 10 };

  it("admits anyone to a course that asks for nothing", () => {
    const open = { minimumCertificationLevel: null, minimumAge: null };
    expect(
      courseEnrollmentRefusal({ actor: "public", course: open, diver: null, courseDate: null }),
    ).toBeNull();
  });

  it("fails the card gate closed: no record, no verified card, or a card below the level", () => {
    const refuse = (diver: Parameters<typeof courseEnrollmentRefusal>[0]["diver"]) =>
      courseEnrollmentRefusal({ actor: "staff", course: needsOpenWater, diver, courseDate: null });
    expect(refuse(null)).toBe("course_prerequisite");
    expect(refuse({ cards: [], dateOfBirth: null })).toBe("course_prerequisite");
    // A diver's own claim is pending, never verified, and reserves no seat.
    expect(refuse({ cards: [card("advanced_open_water", "pending")], dateOfBirth: null })).toBe(
      "course_prerequisite",
    );
    expect(
      refuse({ cards: [card("advanced_open_water", "verified")], dateOfBirth: null }),
    ).toBeNull();
  });

  it("refuses an under-age student at the staff door, on the day the course runs", () => {
    const at = (courseDate: string, actor: "staff" | "public" = "staff") =>
      courseEnrollmentRefusal({
        actor,
        course: tenAndUp,
        diver: { cards: [], dateOfBirth: "2021-06-15" },
        courseDate,
      });
    expect(at("2031-06-14")).toBe("course_min_age");
    expect(at("2031-06-15")).toBeNull();
    // The anonymous form never refuses on someone else's date of birth (H-20260724-certification-levels-agency-rules).
    expect(at("2031-06-14", "public")).toBeNull();
  });

  it("fails the age gate open when there is no date of birth or no record", () => {
    for (const diver of [null, { cards: [], dateOfBirth: null }]) {
      expect(
        courseEnrollmentRefusal({
          actor: "staff",
          course: tenAndUp,
          diver,
          courseDate: "2031-06-14",
        }),
      ).toBeNull();
    }
  });

  it("applies the card gate before the age gate", () => {
    expect(
      courseEnrollmentRefusal({
        actor: "staff",
        course: { minimumCertificationLevel: "open_water", minimumAge: 10 },
        diver: { cards: [], dateOfBirth: "2025-01-01" },
        courseDate: "2031-06-14",
      }),
    ).toBe("course_prerequisite");
  });
});

describe("courseRatioRefusal", () => {
  it("refuses at the ratio cap, and never without one", () => {
    expect(courseRatioRefusal(3, 4)).toBeNull();
    expect(courseRatioRefusal(4, 4)).toBe("course_ratio_full");
    expect(courseRatioRefusal(40, null)).toBeNull();
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
