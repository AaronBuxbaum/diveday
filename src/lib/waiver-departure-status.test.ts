import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import {
  bookingRecordLapsed,
  releaseLapseForBooking,
  shopWaiverStatus,
  WAIVER_SIGNATURE_VALIDITY_MS,
} from "./waivers";

/**
 * **One instant per seat, for every reader and every door** (issue #2611): a
 * release that stands today and runs out before the trip is blocked on the
 * roster, called so (not "lapsed") by the status readers, and replaceable now.
 */
const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-07-18T12:00:00.000Z");
const startsAt = new Date(now.getTime() + 20 * DAY);
const endsAt = new Date(startsAt.getTime() + 5 * 60 * 60 * 1000);
// Signed 350 days ago: 15 days of life left, so it runs out five days before the trip.
const signedAt = new Date(now.getTime() - 350 * DAY);

function release(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    id: "release-1",
    bookingId: "booking-1",
    personId: "person-1",
    status: "completed",
    templateVersion: 1,
    templateGeneration: 1,
    signedAt,
    completedAt: signedAt,
    supersededAt: null,
    expiresAt: signedAt,
    createdAt: signedAt,
    ...overrides,
  } as unknown as WaiverRecord;
}

const seat = (record: WaiverRecord, extra: { heldToMedical?: boolean } = {}) => ({
  bookingWaiver: record,
  personSignedWaivers: [record],
  currentTemplateVersion: 1,
  now,
  startsAt,
  endsAt,
  ...extra,
});

describe("releaseLapseForBooking", () => {
  it("calls a release that is valid today and gone by the trip's end 'before_trip'", () => {
    expect(releaseLapseForBooking(seat(release()))).toBe("before_trip");
  });

  it("calls a release that has already aged out 'lapsed'", () => {
    const old = new Date(now.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - DAY);
    expect(releaseLapseForBooking(seat(release({ signedAt: old, completedAt: old })))).toBe(
      "lapsed",
    );
  });

  it("is null when the release outlasts the trip", () => {
    const fresh = new Date(now.getTime() - 100 * DAY);
    expect(releaseLapseForBooking(seat(release({ signedAt: fresh, completedAt: fresh })))).toBe(
      null,
    );
  });

  it("is null for a diver who never signed", () => {
    expect(
      releaseLapseForBooking({
        bookingWaiver: null,
        personSignedWaivers: [],
        currentTemplateVersion: 1,
        now,
        startsAt,
        endsAt,
      }),
    ).toBe(null);
  });

  it("reads a rider's seat the same way", () => {
    expect(releaseLapseForBooking(seat(release(), { heldToMedical: false }))).toBe("before_trip");
  });

  it("reads a trip under way at now, so a release that stands is not flagged", () => {
    const underWay = {
      startsAt: new Date(now.getTime() - DAY),
      endsAt: new Date(now.getTime() + 6 * DAY),
    };
    expect(releaseLapseForBooking({ ...seat(release()), ...underWay })).toBe(null);
  });
});

describe("bookingRecordLapsed", () => {
  const trip = endsAt;

  it("is true for a signature that is gone at the trip's end, and false while it stands", () => {
    expect(bookingRecordLapsed(release(), 1, trip, true)).toBe(true);
    expect(bookingRecordLapsed(release(), 1, now, true)).toBe(false);
  });

  it("holds a rider's seat to the signature's own clock", () => {
    expect(bookingRecordLapsed(release(), 1, trip, false)).toBe(true);
    expect(bookingRecordLapsed(release(), 1, now, false)).toBe(false);
  });

  it("never calls a pending link lapsed", () => {
    expect(bookingRecordLapsed(release({ status: "pending" }), 1, trip, true)).toBe(false);
    expect(bookingRecordLapsed(release({ status: "pending" }), 1, trip, false)).toBe(false);
  });

  it("calls a signature against changed terms lapsed", () => {
    expect(bookingRecordLapsed(release(), 2, now, true)).toBe(true);
  });
});

describe("shopWaiverStatus through a departure", () => {
  const input = { personSignedWaivers: [release()], currentTemplateVersion: 1, now };

  it("says the release runs out before the trip, with the date it ends", () => {
    const status = shopWaiverStatus({ ...input, through: endsAt });
    expect(status).toMatchObject({
      state: "current",
      runsOutBeforeTrip: true,
      expiresAt: new Date(signedAt.getTime() + WAIVER_SIGNATURE_VALIDITY_MS),
    });
  });

  it("is plain signed when no trip is named, or the release outlasts it", () => {
    expect(shopWaiverStatus(input)).toMatchObject({ state: "current", runsOutBeforeTrip: false });
    expect(
      shopWaiverStatus({ ...input, through: new Date(now.getTime() + 5 * DAY) }),
    ).toMatchObject({ state: "current", runsOutBeforeTrip: false });
  });

  it("never reads earlier than now: a past 'through' changes nothing", () => {
    expect(
      shopWaiverStatus({ ...input, through: new Date(now.getTime() - 5 * DAY) }),
    ).toMatchObject({ state: "current", runsOutBeforeTrip: false });
  });

  it("names the physician's year when it ends first", () => {
    const evaluatedOn = new Date(now.getTime() - 360 * DAY).toISOString().slice(0, 10);
    const cleared = release({
      status: "medical_review",
      signedAt: new Date(now.getTime() - 100 * DAY),
      completedAt: new Date(now.getTime() - 100 * DAY),
      medicalClearedAt: new Date(now.getTime() - 99 * DAY),
      medicalClearanceEvaluatedOn: evaluatedOn,
    });
    const status = shopWaiverStatus({
      personSignedWaivers: [cleared],
      currentTemplateVersion: 1,
      now,
      through: endsAt,
    });
    expect(status).toMatchObject({ state: "current", runsOutBeforeTrip: true });
    if (status.state !== "current") throw new Error("unreachable");
    expect(status.expiresAt.getTime()).toBe(
      Date.parse(`${evaluatedOn}T00:00:00.000Z`) + WAIVER_SIGNATURE_VALIDITY_MS,
    );
  });

  it("is expired, not 'runs out', once the release has already aged out", () => {
    const old = new Date(now.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - DAY);
    expect(
      shopWaiverStatus({
        personSignedWaivers: [release({ signedAt: old, completedAt: old })],
        currentTemplateVersion: 1,
        now,
        through: endsAt,
      }),
    ).toMatchObject({ state: "expired" });
  });
});
