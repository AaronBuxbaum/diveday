import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import { guardianSignatureMissing } from "./guardian";
import {
  bookingRecordLapsed,
  effectiveWaiverForBooking,
  releaseLapseForBooking,
  type SeatWaiverStanding,
  seatWaiverStanding,
  shopWaiverStanding,
} from "./waivers";

/**
 * **A seat names its waiver as the diver record does** (issue #3775). Each case
 * drives the real resolvers into `seatWaiverStanding`, the way the readiness
 * engine does, and pins the answer beside `shopWaiverStanding`'s for the same
 * diver: the roster and the diver record may not call one release two things.
 */

const NOW = new Date("2026-07-18T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const DEPARTS = {
  startsAt: new Date(NOW.getTime() + 2 * DAY),
  endsAt: new Date(NOW.getTime() + 2 * DAY + 4 * 3_600_000),
};
const ADULT = { dateOfBirth: "1990-01-01", minorDeclared: false, timezone: "UTC" } as const;
const MINOR = { dateOfBirth: "2012-01-01", minorDeclared: false, timezone: "UTC" } as const;

function record(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  const signedAt = new Date(NOW.getTime() - DAY);
  return {
    id: "record-1",
    bookingId: "booking-1",
    personId: "person-1",
    status: "completed",
    templateVersion: 1,
    templateGeneration: 1,
    signedAt,
    completedAt: signedAt,
    supersededAt: null,
    expiresAt: new Date(NOW.getTime() + DAY),
    createdAt: new Date(signedAt.getTime() - 60_000),
    guardianSignedAt: null,
    medicalClearedAt: null,
    medicalClearanceDeclinedAt: null,
    ...overrides,
  } as WaiverRecord;
}

/** The seat's reading, assembled the way `listTripsReadiness` assembles it. */
function seat(input: {
  own: WaiverRecord | null;
  signed: readonly WaiverRecord[];
  signer?: typeof ADULT | typeof MINOR;
  generation?: number;
}): SeatWaiverStanding {
  const generation = input.generation ?? 1;
  const base = {
    bookingWaiver: input.own,
    personSignedWaivers: input.signed,
    currentTemplateVersion: generation,
    now: NOW,
  };
  const effective = effectiveWaiverForBooking(base);
  return seatWaiverStanding({
    effective,
    own: input.own,
    releaseLapse: releaseLapseForBooking({ ...base, ...DEPARTS }),
    guardianMissing: Boolean(
      effective && input.signer && guardianSignatureMissing(effective, input.signer),
    ),
    ownLapsed: input.own ? bookingRecordLapsed(input.own, generation, NOW, true) : false,
    now: NOW,
  });
}

describe("a lapsed release", () => {
  const old = record({
    id: "old",
    bookingId: "other",
    signedAt: new Date(NOW.getTime() - 400 * DAY),
    completedAt: new Date(NOW.getTime() - 400 * DAY),
  });

  it("reads lapsed on the seat, as it does on the diver record", () => {
    expect(seat({ own: null, signed: [old] })).toEqual({
      standing: "lapsed",
      control: "lapsed",
      refusalRetired: false,
    });
    expect(
      shopWaiverStanding({ personSignedWaivers: [old], currentTemplateVersion: 1, now: NOW }).state,
    ).toBe("lapsed");
  });

  it("reads none for a diver who never signed", () => {
    expect(seat({ own: null, signed: [] }).standing).toBe("none");
  });

  it("keeps the word of a link that is out: a lapsed release does not hide it", () => {
    const sent = record({
      status: "pending",
      completedAt: null,
      signedAt: null,
      expiresAt: new Date(NOW.getTime() + DAY),
    });
    expect(seat({ own: sent, signed: [old] }).standing).toBe("awaiting_signature");
    const expired = record({
      status: "pending",
      completedAt: null,
      signedAt: null,
      expiresAt: new Date(NOW.getTime() - DAY),
    });
    expect(seat({ own: expired, signed: [old] }).standing).toBe("link_expired");
  });
});

describe("a minor's solo signature", () => {
  it("reads guardian_missing, never signed, and an adult's stays signed", () => {
    const solo = record();
    expect(seat({ own: solo, signed: [solo], signer: MINOR }).standing).toBe("guardian_missing");
    expect(
      shopWaiverStanding({
        personSignedWaivers: [solo],
        currentTemplateVersion: 1,
        signer: MINOR,
        now: NOW,
      }).state,
    ).toBe("guardian_missing");
    expect(seat({ own: solo, signed: [solo], signer: ADULT }).standing).toBe("signed");
  });

  it("reads signed once a guardian co-signed", () => {
    const cosigned = record({ guardianSignedAt: new Date(NOW.getTime() - DAY) });
    expect(seat({ own: cosigned, signed: [cosigned], signer: MINOR }).standing).toBe("signed");
  });
});

describe("a retired refusal", () => {
  const refused = record({
    id: "refused",
    status: "medical_review",
    bookingId: "booking-1",
    signedAt: new Date(NOW.getTime() - 10 * DAY),
    completedAt: new Date(NOW.getTime() - 10 * DAY),
    medicalClearanceDeclinedAt: new Date(NOW.getTime() - 9 * DAY),
    supersededAt: new Date(NOW.getTime() - 5 * DAY),
  });

  it("names the seat's fresh link as the next step while the refusal still governs", () => {
    const sent = record({
      id: "fresh",
      status: "pending",
      completedAt: null,
      signedAt: null,
      expiresAt: new Date(NOW.getTime() + DAY),
    });
    expect(seat({ own: sent, signed: [refused] })).toEqual({
      standing: "medical_not_cleared",
      control: "awaiting_signature",
      refusalRetired: true,
    });
  });

  it("offers a new link, not Signed, when the clean re-sign was against terms the shop since changed", () => {
    const resigned = record({
      id: "resigned",
      templateGeneration: 1,
      signedAt: new Date(NOW.getTime() - 3 * DAY),
      completedAt: new Date(NOW.getTime() - 3 * DAY),
    });
    const result = seat({ own: resigned, signed: [refused, resigned], generation: 2 });
    expect(result).toEqual({
      standing: "medical_not_cleared",
      control: "lapsed",
      refusalRetired: true,
    });
  });

  it("is not a retired refusal while the refused record is the seat's live one", () => {
    const live = { ...refused, supersededAt: null };
    expect(seat({ own: live, signed: [live] })).toEqual({
      standing: "medical_not_cleared",
      control: "medical_not_cleared",
      refusalRetired: false,
    });
  });
});

/**
 * **A changed release never reads "Signed" on the roster** (dock review of
 * #3885): its own word, and the desk's next step is a fresh signature, or the
 * link already out.
 */
describe("seatWaiverStanding: a release whose seal failed", () => {
  const base = {
    releaseLapse: null,
    guardianMissing: false,
    ownLapsed: false,
    now: NOW,
  } as const;

  it("reads the seat's own changed release as seal_failed, with a send", () => {
    const changed = record({ integrityValid: false });
    expect(seatWaiverStanding({ ...base, effective: changed, own: changed })).toEqual({
      standing: "seal_failed",
      control: "seal_failed",
      refusalRetired: false,
    });
  });

  it("reads seal_failed when another release of the person changed", () => {
    const clean = record({ integrityValid: true });
    expect(
      seatWaiverStanding({ ...base, effective: clean, own: clean, sealFailed: true }).standing,
    ).toBe("seal_failed");
  });

  it("points the next step at the fresh link once the desk sent it", () => {
    const changed = record({ integrityValid: false });
    const sent = record({ id: "record-2", status: "pending", signedAt: null, completedAt: null });
    expect(seatWaiverStanding({ ...base, effective: changed, own: sent })).toEqual({
      standing: "seal_failed",
      control: "awaiting_signature",
      refusalRetired: false,
    });
  });
});
