import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import {
  effectiveReleaseForRiderSeat,
  effectiveWaiverForBooking,
  isCompletedWaiverCurrent,
  shopWaiverStanding,
  WAIVER_SIGNATURE_VALIDITY_MS,
  waiverStanding,
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
 * **A signature dated in the future never stands, and never outranks evidence
 * written after it** (issue #3781). A dd/mm file typing `2026-12-03` for
 * 3 December, a slip on the paper path, or a date typed on purpose: whichever
 * writer put it there, the record is ordered by when it reached the shop.
 */
describe("a future-dated signature (issue #3781)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const ahead = (ms: number) => new Date(SIGN_NOW.getTime() + ms);
  const hourAgo = new Date(SIGN_NOW.getTime() - 60 * 60 * 1000);
  const referral = (over: Partial<WaiverRecord> = {}) =>
    completedWaiver({
      id: "referral",
      bookingId: "booking-2",
      status: "medical_review",
      signedAt: hourAgo,
      completedAt: hourAgo,
      createdAt: hourAgo,
      ...over,
    });
  // Written a day ago (an import or a paper copy), claiming a date 30 days ahead.
  const writtenYesterday = new Date(SIGN_NOW.getTime() - DAY);
  const importedAhead = () =>
    completedWaiver({
      id: "future",
      bookingId: null,
      signatureMethod: "imported",
      signedAt: ahead(30 * DAY),
      completedAt: writtenYesterday,
      createdAt: writtenYesterday,
    });
  // The same claim with every stamp in the future, as a writer that copies one
  // date into each field would leave it.
  const allAhead = () =>
    completedWaiver({
      id: "future",
      bookingId: null,
      signedAt: ahead(30 * DAY),
      completedAt: ahead(30 * DAY),
      createdAt: ahead(30 * DAY),
    });

  it("is not a current signature, for a seat in the water or a rider's", () => {
    expect(isCompletedWaiverCurrent(allAhead(), 1, SIGN_NOW)).toBe(false);
    expect(isCompletedWaiverCurrent(importedAhead(), 1, SIGN_NOW)).toBe(false);
    expect(
      effectiveReleaseForRiderSeat({
        bookingWaiver: null,
        personSignedWaivers: [allAhead()],
        currentTemplateVersion: 1,
        now: SIGN_NOW,
      }),
    ).toBeNull();
  });

  it("still stands for a date the shop's own day has reached, read at UTC midnight", () => {
    // An import of "today" in a zone fourteen hours ahead of UTC.
    const today = completedWaiver({
      signatureMethod: "imported",
      signedAt: ahead(14 * 60 * 60 * 1000),
      completedAt: SIGN_NOW,
    });
    expect(isCompletedWaiverCurrent(today, 1, SIGN_NOW)).toBe(true);
    const tomorrow = completedWaiver({
      signatureMethod: "imported",
      signedAt: ahead(14 * 60 * 60 * 1000 + 60_000),
      completedAt: SIGN_NOW,
    });
    expect(isCompletedWaiverCurrent(tomorrow, 1, SIGN_NOW)).toBe(false);
  });

  it.each([
    ["written a day ago", importedAhead],
    ["with every stamp ahead", allAhead],
  ])("never hides a referral given an hour ago on another seat (%s)", (_label, future) => {
    const records = [future(), referral()];
    const effective = effectiveWaiverForBooking({
      bookingWaiver: null,
      personSignedWaivers: records,
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(effective?.id).toBe("referral");
    expect(waiverStanding(effective, SIGN_NOW)).toBe("medical_review");
    expect(
      shopWaiverStanding({ personSignedWaivers: records, currentTemplateVersion: 1, now: SIGN_NOW })
        .state,
    ).toBe("medical_review");
  });

  it("never hides the referral read at a departure past the claimed date either", () => {
    // The trip-scoped instant (`waiverClockInstant`) lies beyond the claimed
    // date, so the future check alone would let the record stand: the order
    // must come from when it was written.
    const departure = ahead(40 * DAY);
    const effective = effectiveWaiverForBooking({
      bookingWaiver: null,
      personSignedWaivers: [importedAhead(), referral()],
      currentTemplateVersion: 1,
      now: departure,
    });
    expect(effective?.id).toBe("referral");
    expect(
      shopWaiverStanding({
        personSignedWaivers: [importedAhead(), referral()],
        currentTemplateVersion: 1,
        now: SIGN_NOW,
        through: departure,
      }).state,
    ).toBe("medical_review");
  });

  it("is not current at any instant when the claimed date is past when it was written", () => {
    // A roster read for a departure beyond the claimed date passes that
    // departure as `now`; the claim is still later than the shop received it.
    const departure = ahead(40 * DAY);
    expect(isCompletedWaiverCurrent(importedAhead(), 1, departure)).toBe(false);
    expect(
      effectiveWaiverForBooking({
        bookingWaiver: null,
        personSignedWaivers: [importedAhead()],
        currentTemplateVersion: 1,
        now: departure,
      }),
    ).toBeNull();
  });

  it("ages from when it was written, never from the claimed date", () => {
    const written = new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1);
    const record = completedWaiver({
      signatureMethod: "imported",
      signedAt: ahead(30 * DAY),
      completedAt: written,
    });
    expect(isCompletedWaiverCurrent(record, 1, ahead(31 * DAY))).toBe(false);
  });

  it("leaves a clean release signed after the referral standing over it", () => {
    const later = completedWaiver({ id: "later", bookingId: null });
    const effective = effectiveWaiverForBooking({
      bookingWaiver: null,
      personSignedWaivers: [referral({ signedAt: new Date(SIGN_NOW.getTime() - 120_000) }), later],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(effective?.id).toBe("later");
  });
});
