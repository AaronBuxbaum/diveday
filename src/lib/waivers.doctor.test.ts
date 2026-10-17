import { describe, expect, it } from "vitest";
import {
  awaitsPhysician,
  DOCTOR_PAGE_TRIP_GRACE_MS,
  doctorPageWithinTrip,
  isUnresolvedMedicalHold,
} from "./waivers";

/**
 * **Whether a release waits on a physician** (the doctor's page's gate): the
 * hold `isUnresolvedMedicalHold` names, less a physician's "no" and erasure.
 */
describe("whether a record waits on a physician", () => {
  const held = {
    status: "medical_review" as const,
    supersededAt: null,
    medicalClearedAt: null,
    medicalClearanceDeclinedAt: null,
    anonymizedAt: null,
  };

  it("is a hold nobody has answered", () => {
    expect(awaitsPhysician(held)).toBe(true);
    expect(isUnresolvedMedicalHold(held)).toBe(true);
    expect(awaitsPhysician({ ...held, status: "completed" })).toBe(false);
  });

  it("ends with either answer, a fresh link, or erasure, and never outlives the hold", () => {
    const at = new Date("2026-10-01T00:00:00.000Z");
    for (const ended of [
      { ...held, medicalClearedAt: at },
      { ...held, medicalClearanceDeclinedAt: at },
      { ...held, supersededAt: at },
      { ...held, anonymizedAt: at },
    ]) {
      expect(awaitsPhysician(ended)).toBe(false);
    }
    const declined = { ...held, medicalClearanceDeclinedAt: at };
    expect(isUnresolvedMedicalHold(declined)).toBe(true);
  });
});

describe("the doctor's page's window", () => {
  const endsAt = new Date("2026-10-20T22:00:00.000Z");

  it("opens until a short grace after the departure ends, and not after", () => {
    expect(doctorPageWithinTrip(endsAt, new Date("2026-10-19T12:00:00.000Z"))).toBe(true);
    const lastMoment = new Date(endsAt.getTime() + DOCTOR_PAGE_TRIP_GRACE_MS - 1);
    expect(doctorPageWithinTrip(endsAt, lastMoment)).toBe(true);
    const closed = new Date(endsAt.getTime() + DOCTOR_PAGE_TRIP_GRACE_MS);
    expect(doctorPageWithinTrip(endsAt, closed)).toBe(false);
  });
});
