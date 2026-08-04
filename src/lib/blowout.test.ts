import { describe, expect, it } from "vitest";
import type { Certification } from "@/db/schema";
import {
  BLOWOUT_MAX_OFFERS,
  BLOWOUT_OFFER_HORIZON_DAYS,
  type BlowoutCandidateTrip,
  type BlowoutDiverContext,
  qualifyingAlternatives,
} from "./blowout";
import type { CertRequirementSource } from "./readiness";
import type { TripAdmissionEvidence } from "./trip-admission";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const CANCELLED_TRIP_ID = "00000000-0000-4000-8000-00000000dead";

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1_000);
}

function certification(overrides: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level: "open_water",
    expiresAt: null,
    ...overrides,
  } as Certification;
}

function evidence(overrides: Partial<TripAdmissionEvidence> = {}): TripAdmissionEvidence {
  return {
    certifications: [],
    specialtyCertifications: [],
    nitroxCertifications: [],
    ...overrides,
  };
}

function requirement(overrides: Partial<CertRequirementSource> = {}): CertRequirementSource {
  return {
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<BlowoutCandidateTrip> = {}): BlowoutCandidateTrip {
  return {
    id: crypto.randomUUID(),
    startsAt: daysFromNow(2),
    status: "scheduled",
    capacity: 8,
    activeBookings: 2,
    courseSession: false,
    requirement: null,
    siteRequirement: null,
    ...overrides,
  };
}

/** A shop-adjudicated Open Water diver — the common carded customer. */
function openWaterDiver(overrides: Partial<BlowoutDiverContext> = {}): BlowoutDiverContext {
  return {
    evidence: evidence({ certifications: [certification()] }),
    identityUnconfirmed: false,
    bookedTripIds: [CANCELLED_TRIP_ID],
    ...overrides,
  };
}

function offers(
  candidates: BlowoutCandidateTrip[],
  diver: BlowoutDiverContext,
  extra: { horizonDays?: number; maxOffers?: number } = {},
): string[] {
  return qualifyingAlternatives({
    cancelledTripId: CANCELLED_TRIP_ID,
    now: NOW,
    candidates,
    diver,
    ...extra,
  });
}

describe("qualifyingAlternatives — the admission filter", () => {
  it("offers only the trips the diver's cards actually admit them to — 2 of 4", () => {
    const easyReef = candidate({ startsAt: daysFromNow(1) });
    const advancedWall = candidate({
      startsAt: daysFromNow(2),
      requirement: requirement({ minimumCertificationLevel: "advanced_open_water" }),
    });
    const deepWreck = candidate({
      startsAt: daysFromNow(3),
      siteRequirement: requirement({ requiredSpecialties: ["deep"] }),
    });
    const nightReef = candidate({ startsAt: daysFromNow(4) });

    expect(offers([easyReef, advancedWall, deepWreck, nightReef], openWaterDiver())).toEqual([
      easyReef.id,
      nightReef.id,
    ]);
  });

  it("qualifies for none → an empty list, never a throw (the message still sends)", () => {
    const advancedOnly = candidate({
      requirement: requirement({ minimumCertificationLevel: "advanced_open_water" }),
    });
    const nitroxOnly = candidate({ requirement: requirement({ requiresNitrox: true }) });
    expect(offers([advancedOnly, nitroxOnly], openWaterDiver())).toEqual([]);
  });

  it("admits an un-adjudicated diver everywhere admission would (unknown diver fails open)", () => {
    const advancedWall = candidate({
      requirement: requirement({ minimumCertificationLevel: "advanced_open_water" }),
    });
    const unknownDiver = openWaterDiver({ evidence: evidence() });
    expect(offers([advancedWall], unknownDiver)).toEqual([advancedWall.id]);
  });

  it("does not judge an identity-unconfirmed diver by the record's cards (H-13)", () => {
    const advancedWall = candidate({
      requirement: requirement({ minimumCertificationLevel: "advanced_open_water" }),
    });
    expect(offers([advancedWall], openWaterDiver({ identityUnconfirmed: true }))).toEqual([
      advancedWall.id,
    ]);
  });
});

describe("qualifyingAlternatives — offerability", () => {
  it("never offers the cancelled trip itself, whatever state its row arrives in", () => {
    const ghost = candidate({ id: CANCELLED_TRIP_ID, status: "scheduled" });
    const real = candidate();
    expect(offers([ghost, real], openWaterDiver())).toEqual([real.id]);
  });

  it("excludes a full trip — a seatless offer is a second disappointment", () => {
    const full = candidate({ capacity: 4, activeBookings: 4 });
    const oneSeatLeft = candidate({ capacity: 4, activeBookings: 3 });
    expect(offers([full, oneSeatLeft], openWaterDiver())).toEqual([oneSeatLeft.id]);
  });

  it("excludes cancelled and already-departed candidates", () => {
    const alsoBlownOut = candidate({ status: "cancelled" });
    const departed = candidate({ startsAt: daysFromNow(-1) });
    const departingRightNow = candidate({ startsAt: NOW });
    const upcoming = candidate();
    expect(offers([alsoBlownOut, departed, departingRightNow, upcoming], openWaterDiver())).toEqual(
      [upcoming.id],
    );
  });

  it("excludes course sessions — enrolment is not a charter-seat replacement", () => {
    const courseSession = candidate({ courseSession: true });
    const charter = candidate();
    expect(offers([courseSession, charter], openWaterDiver())).toEqual([charter.id]);
  });

  it("excludes trips past the offer horizon", () => {
    const nextSeason = candidate({ startsAt: daysFromNow(BLOWOUT_OFFER_HORIZON_DAYS + 1) });
    const insideHorizon = candidate({ startsAt: daysFromNow(BLOWOUT_OFFER_HORIZON_DAYS - 1) });
    expect(offers([nextSeason, insideHorizon], openWaterDiver())).toEqual([insideHorizon.id]);
  });

  it("never offers a trip the diver already holds a seat on", () => {
    const alreadyBooked = candidate();
    const fresh = candidate();
    const diver = openWaterDiver({ bookedTripIds: [CANCELLED_TRIP_ID, alreadyBooked.id] });
    expect(offers([alreadyBooked, fresh], diver)).toEqual([fresh.id]);
  });
});

describe("qualifyingAlternatives — ordering and cap", () => {
  it("returns soonest-first, capped at the offer maximum", () => {
    const byDay = [4, 1, 3, 2, 5].map((day) => candidate({ startsAt: daysFromNow(day) }));
    const result = offers(byDay, openWaterDiver());
    expect(result).toHaveLength(BLOWOUT_MAX_OFFERS);
    const startById = new Map(byDay.map((trip) => [trip.id, trip.startsAt.getTime()]));
    expect(result.map((id) => startById.get(id))).toEqual(
      [1, 2, 3].map((day) => daysFromNow(day).getTime()),
    );
  });

  it("honours a caller-supplied cap and horizon", () => {
    const trips = [1, 2, 3].map((day) => candidate({ startsAt: daysFromNow(day) }));
    expect(offers(trips, openWaterDiver(), { maxOffers: 1 })).toEqual([trips[0].id]);
    expect(offers(trips, openWaterDiver(), { horizonDays: 1 })).toEqual([trips[0].id]);
  });
});
