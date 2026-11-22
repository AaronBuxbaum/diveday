import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import {
  calculateReadiness,
  paymentGateIsUnclearable,
  type ReadinessInput,
  unavailableReadiness,
} from "./readiness";

/**
 * Failure paths of the boarding gate that no sibling file pins: the edges where
 * a softer answer could be read as a clearance.
 */
const now = new Date("2026-07-18T12:00:00.000Z");
const requirement = {
  requiresWaiver: true,
  requiresPayment: false,
  minimumCertificationLevel: "open_water",
  requiredSpecialties: [],
  requiresNitrox: false,
} as unknown as TripRequirement;
const signed = { status: "completed", integrityValid: true } as WaiverRecord;

function codes(input: Partial<ReadinessInput>): string[] {
  return calculateReadiness({
    timezone: "UTC",
    requirement,
    waiver: signed,
    certifications: [],
    now,
    ...input,
  }).blockers.map((blocker) => blocker.code);
}

describe("a course that finishes at this very instant", () => {
  it("is no longer ahead, so the diver is plainly missing the card", () => {
    expect(
      codes({
        certificationsInTraining: [{ level: "open_water", finishesAt: now }],
      }),
    ).toEqual(["certification_missing"]);
  });

  it("is still ahead one millisecond earlier", () => {
    expect(
      codes({
        certificationsInTraining: [
          { level: "open_water", finishesAt: new Date(now.getTime() + 1) },
        ],
      }),
    ).toEqual(["certification_in_training"]);
  });
});

describe("a rider", () => {
  const rider = { participantType: "rider" } as const;

  it("is still held by a release whose seal failed, medical bypass or not", () => {
    expect(
      codes({ ...rider, waiver: { ...signed, integrityValid: false } as WaiverRecord }),
    ).toEqual(["waiver_seal_failed"]);
  });

  it("is held by a person-level seal failure with no release handed in", () => {
    expect(codes({ ...rider, waiver: null, waiverSealFailed: true })).toEqual([
      "waiver_seal_failed",
      "waiver_not_sent",
    ]);
  });
});

describe("a lower verified card beside a higher pending one", () => {
  it("reads as pending review, never cleared", () => {
    const lower = { level: "open_water", status: "verified" } as unknown as Certification;
    const higher = {
      level: "advanced_open_water",
      status: "pending",
      identifier: "123",
    } as unknown as Certification;
    expect(
      codes({
        certifications: [lower, higher],
        requirement: {
          ...requirement,
          minimumCertificationLevel: "rescue",
        } as TripRequirement,
      }),
    ).toEqual(["certification_insufficient"]);
  });
});

describe("a youth course form when the diver's age is not known", () => {
  const SHOP = "00000000-0000-4000-8000-000000000001";
  const form = (overrides: Record<string, unknown>) => ({
    shopId: SHOP,
    formId: "form-youth",
    versionId: "youth-v1",
    version: 1,
    title: "Junior acknowledgment",
    position: 0,
    ...overrides,
  });
  const gaps = (required: ReturnType<typeof form>[], dateOfBirth: string | null) =>
    calculateReadiness({
      timezone: "UTC",
      requirement,
      waiver: signed,
      certifications: [],
      now,
      dateOfBirth,
      courseForms: {
        shopId: SHOP,
        bookingId: "b1",
        personId: "p1",
        required,
        signatures: [],
        timezone: "UTC",
      },
    }).blockers.filter((blocker) => blocker.code === "course_form_unsigned");

  it("says the age bound, so a date of birth may be the whole fix", () => {
    expect(gaps([form({ maxAgeYears: 15 })], null)).toEqual([
      {
        code: "course_form_unsigned",
        params: { formTitle: "Junior acknowledgment", formMaxAge: 15 },
      },
    ]);
  });

  it("names only the form when the age is known, or the form has no age bound", () => {
    expect(gaps([form({ maxAgeYears: 15, sessionFirstDay: "2026-07-18" })], "2015-01-01")).toEqual([
      { code: "course_form_unsigned", params: { formTitle: "Junior acknowledgment" } },
    ]);
    expect(gaps([form({})], null)).toEqual([
      { code: "course_form_unsigned", params: { formTitle: "Junior acknowledgment" } },
    ]);
  });
});

describe("the fallbacks a failed lookup lands on", () => {
  it("blocks with one readiness_unavailable blocker, never a pass", () => {
    expect(unavailableReadiness()).toEqual({
      status: "blocked",
      blockers: [{ code: "readiness_unavailable" }],
    });
  });

  it("calls a below-level card with no number, never self-declared, plainly missing", () => {
    const card = {
      status: "pending",
      level: "open_water",
      identifier: null,
      selfDeclaredAt: null,
    } as unknown as Certification;
    const advanced = { ...requirement, minimumCertificationLevel: "advanced_open_water" };
    expect(codes({ requirement: advanced as TripRequirement, certifications: [card] })).toEqual([
      "certification_missing",
    ]);
  });

  it("calls an unsighted self-declaration with no number what it is", () => {
    const card = {
      status: "pending",
      level: "open_water",
      identifier: null,
      selfDeclaredAt: new Date("2026-07-17T00:00:00.000Z"),
    } as unknown as Certification;
    expect(codes({ certifications: [card] })).toEqual(["certification_self_declared"]);
  });
});

describe("a payment gate no payment can clear", () => {
  it("is a missing or zero price, and not one cent", () => {
    expect(paymentGateIsUnclearable(true, null)).toBe(true);
    expect(paymentGateIsUnclearable(true, 0)).toBe(true);
    expect(paymentGateIsUnclearable(true, 1)).toBe(false);
    expect(paymentGateIsUnclearable(false, null)).toBe(false);
  });
});
