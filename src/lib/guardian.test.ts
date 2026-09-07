import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import {
  guardianSignatureMissing,
  guardianSignatureOf,
  guardianSignatureRequired,
  isGuardianRelationship,
  signingDate,
} from "./guardian";

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
    expect(guardianSignatureRequired(null, "2026-07-18")).toBe(false);
    expect(guardianSignatureRequired(undefined, "2026-07-18")).toBe(false);
  });

  it("is required for a diver under 18 on the signing day and not on their birthday", () => {
    expect(guardianSignatureRequired("2008-07-19", "2026-07-18")).toBe(true);
    expect(guardianSignatureRequired("2008-07-18", "2026-07-18")).toBe(false);
    expect(guardianSignatureRequired("1990-01-01", "2026-07-18")).toBe(false);
  });
});

describe("signingDate", () => {
  it("measures the age on the shop's calendar day, not the server's", () => {
    expect(signingDate(signedAt, TZ)).toBe("2026-07-18");
    expect(signingDate(signedAt, "UTC")).toBe("2026-07-19");
  });
});

describe("guardianSignatureMissing", () => {
  const minor = { dateOfBirth: "2012-03-04", timezone: TZ };
  const adult = { dateOfBirth: "1990-03-04", timezone: TZ };
  const unknown = { dateOfBirth: null, timezone: TZ };

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
    const eighteenOnThe19th = { dateOfBirth: "2008-07-19", timezone: TZ };
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
