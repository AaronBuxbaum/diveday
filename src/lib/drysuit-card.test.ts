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

/**
 * The shop's own catalog, which is the advisory's premise: no drysuit on the
 * wall, no rental drysuit going out, nothing for this check to warn about.
 */
const RENTS_DRYSUITS = ["bcd", "wetsuit", "drysuit"];
const NO_DRYSUITS = ["bcd", "wetsuit"];

describe("checkDrysuitCard", () => {
  it("says nothing about a diver who is not renting a drysuit", () => {
    expect(checkDrysuitCard(false, [], RENTS_DRYSUITS)).toEqual({ status: "ok" });
  });

  it("names the gap when the suit goes out with no drysuit card on file", () => {
    expect(checkDrysuitCard(true, [], RENTS_DRYSUITS)).toEqual({ status: "no_card" });
  });

  it("still names it when the only cards on file are other specialties", () => {
    // The whole point: `deep` says nothing about venting a suit on the way up.
    expect(checkDrysuitCard(true, [specialty({ specialty: "deep" })], RENTS_DRYSUITS)).toEqual({
      status: "no_card",
    });
  });

  it("stays quiet for a diver who holds the card", () => {
    expect(checkDrysuitCard(true, [specialty()], RENTS_DRYSUITS)).toEqual({ status: "ok" });
  });

  it("separates a card awaiting review from no card at all", () => {
    // "One tap from cleared" and "nothing on file" are different jobs for the
    // staffer reading the roster, the same split `specialtyBlocker` makes.
    expect(checkDrysuitCard(true, [specialty({ status: "pending" })], RENTS_DRYSUITS)).toEqual({
      status: "unconfirmed",
    });
  });

  it("holds an unconfirmed import open, exactly as the gate does", () => {
    const imported = specialty({ importedAt: new Date("2026-01-01") });
    expect(checkDrysuitCard(true, [imported], RENTS_DRYSUITS)).toEqual({ status: "unconfirmed" });
    expect(
      checkDrysuitCard(true, [{ ...imported, reviewedAt: new Date("2026-02-01") }], RENTS_DRYSUITS),
    ).toEqual({
      status: "ok",
    });
  });

  it("says nothing once the shop stops renting drysuits at all", () => {
    // `rents_drysuit` deliberately survives the catalog edit (issue #1755) —
    // the diver's answer was theirs and nobody retracted it — but it stops
    // being evidence that a suit is going out, and this advisory's whole
    // premise is a suit coming off this shop's wall. A shop that trials
    // drysuit rental for a season and unticks it would otherwise hand every
    // diver who ever ticked the box a permanent danger-toned line with no way
    // to clear it: the checkbox no longer renders, so neither the staffer nor
    // the diver can retract the flag.
    expect(checkDrysuitCard(true, [], NO_DRYSUITS)).toEqual({ status: "ok" });
    expect(checkDrysuitCard(true, [specialty({ status: "pending" })], NO_DRYSUITS)).toEqual({
      status: "ok",
    });
  });

  it("says it again the moment the shop puts drysuits back", () => {
    // Nothing was destroyed on either side: the stored flag came back with the
    // catalog entry, and so does the advisory.
    expect(checkDrysuitCard(true, [], NO_DRYSUITS)).toEqual({ status: "ok" });
    expect(checkDrysuitCard(true, [], RENTS_DRYSUITS)).toEqual({ status: "no_card" });
  });

  it("raises it when the caller has no catalog to hand", () => {
    // Over-warning is the safe direction for something that gates nothing, and
    // it is the answer `rentalFitCompleteness` already gives an absent catalog.
    expect(checkDrysuitCard(true, [], undefined)).toEqual({ status: "no_card" });
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
    expect(checkDrysuitCard(true, [], RENTS_DRYSUITS)).toEqual({ status: "no_card" });
    expect(readiness.status).toBe("ready");
  });
});
