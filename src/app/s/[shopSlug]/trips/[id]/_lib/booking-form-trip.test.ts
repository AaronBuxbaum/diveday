import { describe, expect, it } from "vitest";
import type { Trip } from "../_components/types";
import { bookingFormTrip } from "./booking-form-trip";

describe("bookingFormTrip", () => {
  it("keeps the facts the form reads and drops everything else", () => {
    const row = {
      capacity: 12,
      booked: 5,
      plannedDives: 3,
      notes: "crew only: skipper on probation",
      boatCertificateCapacity: 14,
      course: {
        minimumAge: 12,
        nitroxCompatible: false,
        gearIncluded: true,
        internalNotes: "instructor ratio waived",
      },
    } as unknown as Trip;

    expect(bookingFormTrip(row)).toStrictEqual({
      capacity: 12,
      booked: 5,
      plannedDives: 3,
      course: { minimumAge: 12, nitroxCompatible: false, gearIncluded: true },
    });
  });

  it("answers no course for an ordinary charter", () => {
    const row = { capacity: 6, booked: 0, plannedDives: 2, course: null } as unknown as Trip;
    expect(bookingFormTrip(row)).toStrictEqual({
      capacity: 6,
      booked: 0,
      plannedDives: 2,
      course: null,
    });
  });
});
