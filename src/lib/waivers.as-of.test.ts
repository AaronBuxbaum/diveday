import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import {
  effectiveReleaseForRiderSeat,
  effectiveWaiverForBooking,
  isCleanCompletion,
  isUnresolvedMedicalHold,
  releaseLapsedForBooking,
} from "./waivers";

const SIGN_NOW = new Date("2026-07-18T12:00:00.000Z");

function completedWaiver(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
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
    expiresAt: new Date(SIGN_NOW.getTime() - 30_000),
    createdAt: new Date(SIGN_NOW.getTime() - 120_000),
    ...overrides,
  } as WaiverRecord;
}

/**
 * **A reading as of a past instant sees only what existed then** (issue
 * #3002). The departure log reads each seat at the boat's cutoff; a release
 * signed after the boat left must never be named as the one she sailed on,
 * and one a later re-sign superseded still stood when she did.
 */
describe("a release read as of a past instant (#3002)", () => {
  const cutoff = new Date(SIGN_NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
  const before = new Date(cutoff.getTime() - 60 * 60 * 1000);
  const after = new Date(cutoff.getTime() + 20 * 24 * 60 * 60 * 1000);
  const sailedOn = completedWaiver({
    id: "sailed-on",
    bookingId: "b-past",
    signedAt: before,
    completedAt: before,
    createdAt: new Date(before.getTime() - 60_000),
  });
  const signedLater = completedWaiver({
    id: "signed-later",
    bookingId: "b-next",
    signedAt: after,
    completedAt: after,
    createdAt: new Date(after.getTime() - 60_000),
  });
  const args = (over: Partial<Parameters<typeof effectiveWaiverForBooking>[0]>) => ({
    bookingWaiver: null,
    personSignedWaivers: [sailedOn, signedLater],
    currentTemplateVersion: 1 as number | null,
    now: cutoff,
    ...over,
  });

  it("names the release that stood at the cutoff, not one signed after it", () => {
    expect(effectiveWaiverForBooking(args({}))?.id).toBe("sailed-on");
    expect(effectiveReleaseForRiderSeat(args({}))?.id).toBe("sailed-on");
  });

  it("still names it when a later re-sign superseded it", () => {
    const superseded = { ...sailedOn, supersededAt: after };
    const read = args({ personSignedWaivers: [superseded, signedLater] });
    expect(effectiveWaiverForBooking(read)?.id).toBe("sailed-on");
    expect(effectiveWaiverForBooking(read)?.supersededAt).toBeNull();
    expect(effectiveReleaseForRiderSeat(read)?.id).toBe("sailed-on");
    // Superseded before the cutoff, it did not stand.
    const supersededFirst = { ...sailedOn, supersededAt: new Date(cutoff.getTime() - 1) };
    expect(effectiveWaiverForBooking(args({ personSignedWaivers: [supersededFirst] }))).toBeNull();
  });

  it("names nothing when the only release was signed after the cutoff, and calls nothing lapsed", () => {
    const read = args({ personSignedWaivers: [signedLater] });
    expect(effectiveWaiverForBooking(read)).toBeNull();
    expect(effectiveReleaseForRiderSeat(read)).toBeNull();
    expect(releaseLapsedForBooking(read)).toBe(false);
    // The seat's own record, signed after the cutoff, did not stand either.
    const ownLater = { ...signedLater, bookingId: "booking-1" };
    expect(
      effectiveWaiverForBooking(args({ bookingWaiver: ownLater, personSignedWaivers: [] })),
    ).toBeNull();
    expect(
      effectiveReleaseForRiderSeat(args({ bookingWaiver: ownLater, personSignedWaivers: [] })),
    ).toBeNull();
  });

  it("never lets a hold disclosed after the cutoff outrank the release that stood", () => {
    const laterHold = completedWaiver({
      id: "later-hold",
      status: "medical_review",
      signedAt: after,
      completedAt: after,
    });
    expect(
      effectiveWaiverForBooking(args({ personSignedWaivers: [sailedOn, laterHold] }))?.id,
    ).toBe("sailed-on");
  });

  it("reads a referral a physician cleared after the cutoff as the hold it was", () => {
    const referral = completedWaiver({
      id: "referral",
      status: "medical_review",
      signedAt: before,
      completedAt: before,
      medicalClearedAt: after,
      medicalClearedByPersonId: "staff-1",
      medicalClearanceEvaluatedOn: "2026-06-30",
      medicalClearancePhysicianName: "Dr. Ana Ruiz",
    });
    const atCutoff = effectiveWaiverForBooking(args({ personSignedWaivers: [referral] }));
    expect(atCutoff?.id).toBe("referral");
    // Nothing downstream can name who recorded an answer not yet given.
    expect(atCutoff?.medicalClearedByPersonId).toBeNull();
    expect(atCutoff?.medicalClearanceEvaluatedOn).toBeNull();
    expect(atCutoff?.medicalClearancePhysicianName).toBeNull();
    expect(atCutoff && isUnresolvedMedicalHold(atCutoff)).toBe(true);
    expect(atCutoff && isCleanCompletion(atCutoff)).toBe(false);
    // Read today, the clearance stands and the record is a clean release.
    const today = effectiveWaiverForBooking(
      args({ personSignedWaivers: [referral], now: SIGN_NOW }),
    );
    expect(today).toBe(referral);
  });

  it("changes nothing for a reader at the live clock", () => {
    const live = args({ now: SIGN_NOW });
    expect(effectiveWaiverForBooking(live)).toBe(signedLater);
    expect(effectiveReleaseForRiderSeat(live)).toBe(signedLater);
  });
});
