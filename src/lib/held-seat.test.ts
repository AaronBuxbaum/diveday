import { describe, expect, it } from "vitest";

import {
  isHeldSeat,
  SEAT_OWN_BLOCKER_CODES,
  seatName,
  withholdHeldSeatParticulars,
} from "./held-seat";
import { heldSeatBlockers } from "./identity-match";
import type { TripManifest } from "./manifests";
import { BLOCKER_CATEGORY, type ReadinessBlocker, type ReadinessBlockerCode } from "./readiness";

type ManifestDiver = TripManifest["divers"][number];

const matchedPerson: ManifestDiver = {
  bookingId: "00000000-0000-4000-8000-000000000001",
  fullName: "Maria Santos",
  email: "maria@example.com",
  emergencyContactName: "Luis Santos",
  emergencyContactPhone: "+1-305-555-0199",
  readiness: { status: "ready", blockers: [] },
  rentalFit: { state: "own_kit" },
  nitroxRequested: true,
  age: 14,
  minor: true,
  birthday: { status: "today" },
  welcomeCue: { kind: "first_trip" },
  depthAdvisory: { status: "exceeds" } as ManifestDiver["depthAdvisory"],
  medicalWaiver: {
    source: "digital",
    at: new Date("2026-09-01T12:00:00.000Z"),
  } as ManifestDiver["medicalWaiver"],
  hotelPickupLocation: "Casa Marina",
  pickupTime: "07:15",
  checkedIn: true,
  notHere: false,
  buddyTeam: {
    teamId: "team-1",
    others: [{ kind: "diver", bookingId: "b2", fullName: "Ana Ruiz" }],
  },
  buddyAlert: null,
  rollCall: {
    state: "boarded",
    occurredAt: new Date("2026-09-11T12:22:00.000Z"),
    recordedByName: "Keiko Tanaka",
  },
} as ManifestDiver;

const held = (blockers: ReadinessBlocker[]): ManifestDiver => ({
  ...matchedPerson,
  identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
  readiness: { status: "blocked", blockers },
});

describe("the name a seat goes by (issue #1690)", () => {
  const at = new Date("2026-10-01T12:00:00.000Z");
  it("is the booked-as name while the seat is held", () => {
    expect(seatName("Maria Santos", { identityUnconfirmedAt: at, identityBookedAs: " Mia " })).toBe(
      "Mia",
    );
  });
  it("is the person's own name once confirmed, whatever was booked", () => {
    expect(seatName("Maria Santos", { identityUnconfirmedAt: null, identityBookedAs: "Mia" })).toBe(
      "Maria Santos",
    );
  });
});

describe("withholding a held seat's particulars (issue #1690)", () => {
  it("clears every fact about the matched person", () => {
    const shown = withholdHeldSeatParticulars(
      held([{ code: "identity_unconfirmed" }, { code: "medical_review" }]),
    );
    expect(shown).toMatchObject({
      identityWithheld: true,
      email: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      rentalFit: { state: "not_recorded" },
      nitroxRequested: false,
      age: null,
      // Unknown, never "an adult".
      minor: null,
      birthday: null,
      welcomeCue: null,
      medicalWaiver: null,
    });
    expect(shown.depthAdvisory).toBeUndefined();
  });

  it("keeps the seat: its name as booked, state, mark, desk flags, team and pickup", () => {
    const shown = withholdHeldSeatParticulars(held([{ code: "identity_unconfirmed" }]));
    expect(shown).toMatchObject({
      bookingId: matchedPerson.bookingId,
      // Who walks up the gangway, not the matched person.
      fullName: "Maria",
      moreHoldsBehindConfirmation: false,
      identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
      hotelPickupLocation: "Casa Marina",
      pickupTime: "07:15",
      checkedIn: true,
      notHere: false,
      buddyTeam: matchedPerson.buddyTeam,
      rollCall: matchedPerson.rollCall,
    });
    // A seat that cannot board still says so: the status is never softened.
    expect(shown.readiness.status).toBe("blocked");
  });

  it("drops the blockers measured against the matched person and keeps the seat's own", () => {
    const shown = withholdHeldSeatParticulars(
      held([
        { code: "identity_unconfirmed" },
        { code: "medical_review" },
        { code: "under_minimum_age" },
        { code: "certification_missing" },
        { code: "payment_due" },
      ]),
    );
    expect(shown.readiness.blockers.map((blocker) => blocker.code)).toEqual([
      "identity_unconfirmed",
      "payment_due",
    ]);
    // The dropped ones are still said to exist, by a flag with no category.
    expect(shown.moreHoldsBehindConfirmation).toBe(true);
  });

  it("keeps the blockers about the system, which no identity answer clears", () => {
    const shown = withholdHeldSeatParticulars(
      held([
        { code: "identity_unconfirmed" },
        { code: "readiness_unavailable" },
        { code: "requirements_not_configured" },
      ]),
    );
    expect(shown.readiness.blockers.map((blocker) => blocker.code)).toEqual([
      "identity_unconfirmed",
      "readiness_unavailable",
      "requirements_not_configured",
    ]);
    expect(shown.moreHoldsBehindConfirmation).toBe(false);
  });

  it("keeps the matched person's name when the claim never recorded another", () => {
    const shown = withholdHeldSeatParticulars({
      ...held([{ code: "identity_unconfirmed" }]),
      identityClaim: { bookedAs: null, matchedBy: null },
    });
    expect(shown.fullName).toBe("Maria Santos");
  });

  it("leaves a confirmed seat exactly as it was", () => {
    const confirmed = {
      ...matchedPerson,
      readiness: { status: "blocked" as const, blockers: [{ code: "medical_review" as const }] },
    };
    expect(withholdHeldSeatParticulars(confirmed)).toBe(confirmed);
    expect(isHeldSeat(confirmed)).toBe(false);
  });

  it("withholds on the claim alone when readiness could not be read", () => {
    // Fails toward withholding: the readiness read failed closed, so its
    // identity blocker is absent, but the booking still says it is held.
    const shown = withholdHeldSeatParticulars(held([{ code: "readiness_unavailable" }]));
    expect(shown.identityWithheld).toBe(true);
    expect(shown.emergencyContactPhone).toBeNull();
  });

  it("blocks a held seat, and says why, even when readiness read it as ready", () => {
    // A claim with no identity blocker must never reach a crew phone as
    // ready to board (dive-domain re-review).
    const shown = withholdHeldSeatParticulars({
      ...matchedPerson,
      identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
      readiness: { status: "ready", blockers: [] },
    });
    expect(shown.readiness).toEqual({
      status: "blocked",
      blockers: [{ code: "identity_unconfirmed" }],
    });
    expect(shown.moreHoldsBehindConfirmation).toBe(false);
  });

  it("is unchanged by a second pass, so a page and its component can both apply it", () => {
    const once = withholdHeldSeatParticulars(
      held([{ code: "identity_unconfirmed" }, { code: "medical_review" }]),
    );
    expect(once.moreHoldsBehindConfirmation).toBe(true);
    expect(withholdHeldSeatParticulars(once)).toBe(once);
  });

  it("withholds on the blocker alone when no claim was assembled", () => {
    const shown = withholdHeldSeatParticulars({
      ...matchedPerson,
      readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
    });
    expect(shown.identityWithheld).toBe(true);
    expect(shown.age).toBeNull();
  });

  it("names the seat's own blockers exactly as the roster's rule does", () => {
    // `held-seat.ts` cannot import `BLOCKER_CATEGORY` (the service worker
    // carries it), so its list is spelled out. This keeps the two in step: a
    // new payment code that the roster keeps on a held seat must be kept here.
    const codes = Object.keys(BLOCKER_CATEGORY) as ReadinessBlockerCode[];
    const keptByRoster = heldSeatBlockers([
      { code: "identity_unconfirmed" },
      ...codes.map((code) => ({ code }) as ReadinessBlocker),
    ]).map((blocker) => blocker.code);
    expect(new Set(keptByRoster)).toEqual(new Set(SEAT_OWN_BLOCKER_CODES));
  });
});
