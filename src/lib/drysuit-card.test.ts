import { describe, expect, it } from "vitest";
import type { SpecialtyCertification, TripRequirement, WaiverRecord } from "@/db/schema";
import { checkDrysuitCard } from "./drysuit-card";
import { calculateReadiness } from "./readiness";

function specialty(overrides: Partial<SpecialtyCertification> = {}): SpecialtyCertification {
  return {
    specialty: "drysuit",
    status: "verified",
    importedAt: null,
    reviewedAt: null,
    ...overrides,
  } as SpecialtyCertification;
}

describe("checkDrysuitCard", () => {
  it("says nothing about a diver who is not in a drysuit", () => {
    expect(checkDrysuitCard(false, [], null)).toEqual({ status: "ok" });
  });

  it("names the gap when a diver in a drysuit has no drysuit card on file", () => {
    expect(checkDrysuitCard(true, [], null)).toEqual({ status: "no_card" });
  });

  it("still names it when the only cards on file are other specialties", () => {
    // The whole point: `deep` says nothing about venting a suit on the way up.
    expect(checkDrysuitCard(true, [specialty({ specialty: "deep" })], null)).toEqual({
      status: "no_card",
    });
  });

  it("stays quiet for a diver who holds the card", () => {
    expect(checkDrysuitCard(true, [specialty()], null)).toEqual({ status: "ok" });
  });

  it("separates a card awaiting review from no card at all", () => {
    // "One tap from cleared" and "nothing on file" are different jobs for the
    // staffer reading the roster, the same split `specialtyBlocker` makes.
    expect(checkDrysuitCard(true, [specialty({ status: "pending" })], null)).toEqual({
      status: "unconfirmed",
    });
  });

  it("holds an unconfirmed import open, exactly as the gate does", () => {
    const imported = specialty({ importedAt: new Date("2026-01-01") });
    expect(checkDrysuitCard(true, [imported], null)).toEqual({ status: "unconfirmed" });
    expect(
      checkDrysuitCard(true, [{ ...imported, reviewedAt: new Date("2026-02-01") }], null),
    ).toEqual({
      status: "ok",
    });
  });

  it("is never a gate: diving dry uncarded cannot block a diver", () => {
    // The advisory and the readiness engine are different instruments. A shop
    // that wants the suit gated requires the `drysuit` specialty on the site or
    // the trip; nothing here may do it for them.
    const readiness = calculateReadiness({
      timezone: "UTC",
      requirement: {
        requiresWaiver: true,
        minimumCertificationLevel: null,
        requiredSpecialties: [],
      } as unknown as TripRequirement,
      waiver: {
        status: "completed",
        expiresAt: new Date("2026-09-19T12:00:00.000Z"),
      } as WaiverRecord,
      certifications: [],
      specialtyCertifications: [],
      paymentStatus: "paid",
      now: new Date("2026-09-12T12:00:00.000Z"),
    });
    expect(checkDrysuitCard(true, [], null)).toEqual({ status: "no_card" });
    expect(readiness.status).toBe("ready");
  });

  describe("staff-observed drysuit experience (#2136)", () => {
    const seen = new Date("2026-10-01T09:00:00.000Z");

    it("clears the advisory for a diver in a drysuit with no card", () => {
      expect(checkDrysuitCard(true, [], seen)).toEqual({ status: "ok" });
    });

    it("clears it when the only drysuit card is unconfirmed, too", () => {
      expect(checkDrysuitCard(true, [specialty({ status: "pending" })], seen)).toEqual({
        status: "ok",
      });
    });

    it("still fires without the fact", () => {
      expect(checkDrysuitCard(true, [], null)).toEqual({ status: "no_card" });
      expect(checkDrysuitCard(true, [specialty({ specialty: "deep" })], null)).toEqual({
        status: "no_card",
      });
    });

    it("is not a card: a trip requiring the drysuit specialty still refuses", () => {
      // The fact lives on the person, never in specialty_certifications, so the
      // readiness gate cannot see it. Seen-diving-dry clears a warning only.
      const readiness = calculateReadiness({
        timezone: "UTC",
        requirement: {
          requiresWaiver: false,
          minimumCertificationLevel: null,
          requiredSpecialties: ["drysuit"],
        } as unknown as TripRequirement,
        waiver: null,
        certifications: [],
        specialtyCertifications: [],
        paymentStatus: "paid",
        now: new Date("2026-10-02T12:00:00.000Z"),
      });
      expect(checkDrysuitCard(true, [], seen)).toEqual({ status: "ok" });
      expect(readiness.status).not.toBe("ready");
    });
  });
});
