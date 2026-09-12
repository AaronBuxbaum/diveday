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
  it("says nothing about a diver who is not renting a drysuit", () => {
    expect(checkDrysuitCard(false, [])).toEqual({ status: "ok" });
  });

  it("names the gap when the suit goes out with no drysuit card on file", () => {
    expect(checkDrysuitCard(true, [])).toEqual({ status: "no_card" });
  });

  it("still names it when the only cards on file are other specialties", () => {
    // The whole point: `deep` says nothing about venting a suit on the way up.
    expect(checkDrysuitCard(true, [specialty({ specialty: "deep" })])).toEqual({
      status: "no_card",
    });
  });

  it("stays quiet for a diver who holds the card", () => {
    expect(checkDrysuitCard(true, [specialty()])).toEqual({ status: "ok" });
  });

  it("separates a card awaiting review from no card at all", () => {
    // "One tap from cleared" and "nothing on file" are different jobs for the
    // staffer reading the roster, the same split `specialtyBlocker` makes.
    expect(checkDrysuitCard(true, [specialty({ status: "pending" })])).toEqual({
      status: "unconfirmed",
    });
  });

  it("holds an unconfirmed import open, exactly as the gate does", () => {
    const imported = specialty({ importedAt: new Date("2026-01-01") });
    expect(checkDrysuitCard(true, [imported])).toEqual({ status: "unconfirmed" });
    expect(checkDrysuitCard(true, [{ ...imported, reviewedAt: new Date("2026-02-01") }])).toEqual({
      status: "ok",
    });
  });

  it("is never a gate: renting a drysuit uncarded cannot block a diver", () => {
    // The advisory and the readiness engine are different instruments. A shop
    // that wants the suit gated requires the `drysuit` specialty on the site or
    // the trip; nothing here may do it for them.
    const readiness = calculateReadiness({
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
    expect(checkDrysuitCard(true, [])).toEqual({ status: "no_card" });
    expect(readiness.status).toBe("ready");
  });
});
