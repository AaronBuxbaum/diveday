import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import {
  guardianSignatureMissing,
  guardianSignatureOf,
  guardianSignatureRequired,
  isGuardianRelationship,
  minorDeclaredOnLiveUpcomingSeat,
  signingDate,
} from "./guardian";
import { DEPARTURE_BUFFER_MS } from "./trips";

const TZ = "America/New_York";
/** Signed 2026-07-18 at 23:30 New York — 2026-07-19 in UTC, which is the trap. */
const signedAt = new Date("2026-07-19T03:30:00.000Z");

function record(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    status: "completed",
    signedAt,
    completedAt: signedAt,
    guardianSignedAt: null,
    guardianName: null,
    guardianRelationship: null,
    ...overrides,
  } as WaiverRecord;
}

describe("guardianSignatureRequired (ADR 20260907-guardian-co-signature)", () => {
  it("fails open when the shop holds no date of birth", () => {
    expect(guardianSignatureRequired(null, "2026-07-18", false)).toBe(false);
    expect(guardianSignatureRequired(undefined, "2026-07-18", false)).toBe(false);
  });

  it("is required for a diver under 18 on the signing day and not on their birthday", () => {
    expect(guardianSignatureRequired("2008-07-19", "2026-07-18", false)).toBe(true);
    expect(guardianSignatureRequired("2008-07-18", "2026-07-18", false)).toBe(false);
    expect(guardianSignatureRequired("1990-01-01", "2026-07-18", false)).toBe(false);
  });
});

describe("a seat its booker marked Under 18 (decision 2026-10-13)", () => {
  it("asks for a guardian when the shop holds no date of birth", () => {
    expect(guardianSignatureRequired(null, "2026-07-18", true)).toBe(true);
    expect(guardianSignatureRequired(undefined, "2026-07-18", true)).toBe(true);
  });

  it("lets a date of birth on file decide, so a staffer can correct a wrong tick", () => {
    expect(guardianSignatureRequired("1990-01-01", "2026-07-18", true)).toBe(false);
    expect(guardianSignatureRequired("2012-01-01", "2026-07-18", false)).toBe(true);
  });

  it("blocks a release the declared minor signed alone, and clears a co-signed one", () => {
    const declared = { dateOfBirth: null, minorDeclared: true, timezone: TZ };
    expect(guardianSignatureMissing(record(), declared)).toBe(true);
    expect(guardianSignatureMissing(record({ guardianSignedAt: signedAt }), declared)).toBe(false);
  });
});

describe("signingDate", () => {
  it("measures the age on the shop's calendar day, not the server's", () => {
    expect(signingDate(signedAt, TZ)).toBe("2026-07-18");
    expect(signingDate(signedAt, "UTC")).toBe("2026-07-19");
  });
});

describe("guardianSignatureMissing", () => {
  const minor = { dateOfBirth: "2012-03-04", minorDeclared: false, timezone: TZ };
  const adult = { dateOfBirth: "1990-03-04", minorDeclared: false, timezone: TZ };
  const unknown = { dateOfBirth: null, minorDeclared: false, timezone: TZ };

  it("blocks a minor who signed alone", () => {
    expect(guardianSignatureMissing(record(), minor)).toBe(true);
  });

  it("clears a minor whose guardian co-signed", () => {
    expect(guardianSignatureMissing(record({ guardianSignedAt: signedAt }), minor)).toBe(false);
  });

  it("never asks an adult, or a diver with no date on file, for a guardian", () => {
    expect(guardianSignatureMissing(record(), adult)).toBe(false);
    expect(guardianSignatureMissing(record(), unknown)).toBe(false);
  });

  it("measures minority on the signing day: a diver who turned 18 the day after still signed as a minor", () => {
    const eighteenOnThe19th = { dateOfBirth: "2008-07-19", minorDeclared: false, timezone: TZ };
    expect(guardianSignatureMissing(record(), eighteenOnThe19th)).toBe(true);
    // ...and the zone decides which day that was.
    expect(guardianSignatureMissing(record(), { ...eighteenOnThe19th, timezone: "UTC" })).toBe(
      false,
    );
  });

  it("is somebody else's blocker on a record nobody has signed", () => {
    expect(guardianSignatureMissing(record({ status: "pending" }), minor)).toBe(false);
    expect(guardianSignatureMissing(record({ signedAt: null, completedAt: null }), minor)).toBe(
      false,
    );
  });

  it("holds over a medical-review record too, since that is a signed release parked", () => {
    expect(guardianSignatureMissing(record({ status: "medical_review" }), minor)).toBe(true);
  });
});

describe("guardianSignatureOf", () => {
  it("returns the co-signer for a surface, and nothing after erasure took the name", () => {
    expect(
      guardianSignatureOf(
        record({
          guardianSignedAt: signedAt,
          guardianName: "Jonas Fischer",
          guardianRelationship: "parent",
        }),
      ),
    ).toEqual({ name: "Jonas Fischer", relationship: "parent" });
    expect(
      guardianSignatureOf(
        record({ guardianSignedAt: signedAt, guardianName: null, guardianRelationship: "parent" }),
      ),
    ).toBeNull();
    expect(guardianSignatureOf(record())).toBeNull();
  });

  it("refuses a relationship that is not one of the two codes", () => {
    expect(isGuardianRelationship("parent")).toBe(true);
    expect(isGuardianRelationship("legal_guardian")).toBe(true);
    expect(isGuardianRelationship("uncle")).toBe(false);
    expect(
      guardianSignatureOf(
        record({ guardianSignedAt: signedAt, guardianName: "X Y", guardianRelationship: "uncle" }),
      ),
    ).toBeNull();
  });
});

/**
 * West of UTC the trap is the other way round, and wider. Honolulu runs ten
 * hours behind with no daylight saving, so 23:30 on the eve of an 18th
 * birthday is already 09:30 on the birthday in UTC. A reading in the wrong
 * zone would clear a seventeen-year-old's solo signature.
 */
describe("signing in Pacific/Honolulu on the eve of the 18th birthday", () => {
  /** 2026-07-18 at 23:30 Honolulu. */
  const lateEve = new Date("2026-07-19T09:30:00.000Z");
  const turnsEighteenOnThe19th = { dateOfBirth: "2008-07-19", minorDeclared: false };

  it("reads the signing day as the 18th, the last day of being seventeen", () => {
    expect(signingDate(lateEve, "Pacific/Honolulu")).toBe("2026-07-18");
    expect(signingDate(lateEve, "UTC")).toBe("2026-07-19");
  });

  it("needs a guardian when read in the shop's own zone", () => {
    const solo = record({ signedAt: lateEve, completedAt: lateEve });
    expect(
      guardianSignatureMissing(solo, { ...turnsEighteenOnThe19th, timezone: "Pacific/Honolulu" }),
    ).toBe(true);
    // The same instant read in UTC is the birthday itself: the wrong zone clears it.
    expect(guardianSignatureMissing(solo, { ...turnsEighteenOnThe19th, timezone: "UTC" })).toBe(
      false,
    );
  });
});

/**
 * **A person-scoped reader takes the booker's "Under 18" from a live seat
 * still ahead** (issue #2553, Option A, Aaron 2026-10-24). A seat that no
 * longer stands, or a dive already over, says nothing about the person today.
 */
describe("minorDeclaredOnLiveUpcomingSeat", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");
  const later = new Date("2026-10-26T12:00:00.000Z");
  const declared = new Date("2026-10-20T12:00:00.000Z");
  function seat(overrides: {
    status?: string;
    minorDeclaredAt?: Date | null;
    deletedAt?: Date | null;
    tripStatus?: string;
    endsAt?: Date;
  }) {
    return {
      status: overrides.status ?? "booked",
      minorDeclaredAt:
        overrides.minorDeclaredAt === undefined ? declared : overrides.minorDeclaredAt,
      trip: {
        deletedAt: overrides.deletedAt ?? null,
        status: overrides.tripStatus ?? "scheduled",
        endsAt: overrides.endsAt ?? later,
      },
    };
  }

  it("reads true for a declared seat on a departure still ahead, or still out", () => {
    expect(minorDeclaredOnLiveUpcomingSeat([seat({})], now)).toBe(true);
    expect(minorDeclaredOnLiveUpcomingSeat([seat({ status: "checked_in" })], now)).toBe(true);
    // The boat is out: the dive is not over, so the seat still speaks.
    expect(
      minorDeclaredOnLiveUpcomingSeat([seat({ endsAt: new Date(now.getTime() + 60_000) })], now),
    ).toBe(true);
  });

  it("reads true when any one seat is declared, whatever the others say", () => {
    expect(minorDeclaredOnLiveUpcomingSeat([seat({ minorDeclaredAt: null }), seat({})], now)).toBe(
      true,
    );
  });

  it("reads false with no seats, or no declared seat", () => {
    expect(minorDeclaredOnLiveUpcomingSeat([], now)).toBe(false);
    expect(minorDeclaredOnLiveUpcomingSeat([seat({ minorDeclaredAt: null })], now)).toBe(false);
  });

  it("ignores a cancelled seat, a deleted or called-off departure, and a dive already over", () => {
    expect(minorDeclaredOnLiveUpcomingSeat([seat({ status: "cancelled" })], now)).toBe(false);
    expect(minorDeclaredOnLiveUpcomingSeat([seat({ deletedAt: declared })], now)).toBe(false);
    expect(minorDeclaredOnLiveUpcomingSeat([seat({ tripStatus: "cancelled" })], now)).toBe(false);
    // A boat due back but inside the late-arrival hour is still out.
    expect(minorDeclaredOnLiveUpcomingSeat([seat({ endsAt: now })], now)).toBe(true);
    expect(
      minorDeclaredOnLiveUpcomingSeat(
        [seat({ endsAt: new Date(now.getTime() - DEPARTURE_BUFFER_MS) })],
        now,
      ),
    ).toBe(false);
    expect(
      minorDeclaredOnLiveUpcomingSeat(
        [seat({ endsAt: new Date("2026-10-01T12:00:00.000Z") })],
        now,
      ),
    ).toBe(false);
  });
});
