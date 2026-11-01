import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "known-answer-secret";
const BOOKING = "0b9d6f3e-1c2a-4d4e-8a5b-6c7d8e9f0a1b";

/** Minted by the hand-rolled implementations this file's primitive replaced, at SECRET. */
const MINTED = {
  recap:
    "cmVjYXA6MGI5ZDZmM2UtMWMyYS00ZDRlLThhNWItNmM3ZDhlOWYwYTFiOjE3ODQ2NDA2MDA.GYaO7xgfnY3d64o12MpiigGlxJgZigjOSPqkVP56Hxo",
  buddy: "C51vPhwqTU6KW2x9jp8KGw.mrcKxb4Uzf_4yf8N",
  gate: "~~~1.kXvijUe6Lgt06VAEkkSS6o5FpWG7F8xMx_UuZ_02eY8",
  epoch: "3.2.chedpM2MpU5HmuVTgGjG6kXVU4lcQgEtqH0Kljg6lhM",
  preview: "1800000600000.ESwgziOoL_4ex9mIyStw-Ca2tEV1fMIuCozTfXuImRg",
  catchUp:
    "WyIwYjlkNmYzZS0xYzJhLTRkNGUtOGE1Yi02YzdkOGU5ZjBhMWIiXQ.P0ivyYCmINODQ2E9KGOkqJ4ejl8IEGO6WXOiv4C0IZc",
  move: "eyJwdXJwb3NlIjoic2NoZWR1bGUtbW92ZS1yZXN1bHQtdjEiLCJzaG9wSWQiOiJzaG9wIiwiaWQiOiIwYjlkNmYzZS0xYzJhLTRkNGUtOGE1Yi02YzdkOGU5ZjBhMWIiLCJnZWFyUmVsZWFzZWQiOjIsImlzc3VlZEF0IjoxNzg0NjQwNjAwMDAwfQ.8Sp2MiwtBTLSq_U6AkCMg7o0dpBCx6CpVy8BC9LpOXE",
  seat: "A2pl0lUFLg2kI6mFFgH1ug.1800086400000.agydqh_W2-clM-gIqe1Al5q9PyEHvgo0UwGK-x0rpQE",
  name: "1800604800000.Qmx1ZSBSZWVm.cQFLmi5eRGnS14kW2dCRI2iJxWQBz8rjlXxVErX-jNQ",
  quiet: "tbEOdFPi5zoL2KF_HRX3TJjYQHefTb6_39rTjD7dGy8",
};
const QUIET_ENV = { DEMO_QUIET_KEY: "quiet-key-quiet-key-quiet-key-1" };
const GATE_REFUSAL = {
  requiredLevel: null,
  heldLevel: null,
  missingSpecialties: [],
  nitroxRequired: true,
} as never;
const GATE_SCOPE = { kind: "trip", id: BOOKING } as never;
const CATCH_UP_SCOPE = { shopId: "s", personId: "p", dayStart: "d", mode: "ack" as const };

describe("modules still mint and verify the tokens they always did", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("RECAP_LINK_SECRET", "");
    vi.stubEnv("BUDDY_LINK_SECRET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recap links", async () => {
    const m = await import("./recap-links");
    expect(m.signRecapToken(BOOKING)).toBe(MINTED.recap);
    expect(m.verifyRecapToken(MINTED.recap)).toBe(BOOKING);
    expect(m.verifyRecapToken(`${MINTED.recap.slice(0, -1)}é`)).toBeNull();
    expect(m.verifyRecapToken(MINTED.recap.slice(0, -1))).toBeNull();
  });

  it("buddy referrals", async () => {
    const m = await import("./buddy-tokens");
    expect(m.buddyReferralId(BOOKING)).toBe(MINTED.buddy);
    expect(m.bookingIdFromBuddyReferral(MINTED.buddy)).toBe(BOOKING);
    expect(m.bookingIdFromBuddyReferral(`${MINTED.buddy.slice(0, -1)}A`)).toBeNull();
  });

  it("trip-admission gate", async () => {
    const m = await import("./trip-admission-gate");
    expect(m.signTripAdmissionGate(GATE_REFUSAL, GATE_SCOPE)).toBe(MINTED.gate);
    expect(m.verifyTripAdmissionGate(MINTED.gate, GATE_SCOPE)).not.toBeNull();
    expect(m.verifyTripAdmissionGate(`${MINTED.gate.slice(0, -1)}é`, GATE_SCOPE)).toBeNull();
    expect(m.verifyTripAdmissionGate(MINTED.gate, { kind: "trip", id: "x" } as never)).toBeNull();
  });

  it("offline erasure epoch", async () => {
    const m = await import("./offline-erasure-epoch");
    const input = { shopId: "s", tripId: "t", snapshotId: BOOKING, epoch: 3, snapshotRevision: 2 };
    expect(m.signOfflineErasureEpoch(input)).toBe(MINTED.epoch);
    expect(m.verifyOfflineErasureEpoch({ token: MINTED.epoch, ...input })).toBe(3);
    expect(
      m.verifyOfflineErasureEpoch({ token: `${MINTED.epoch.slice(0, -1)}é`, ...input }),
    ).toBeNull();
    expect(m.verifyOfflineErasureEpoch({ token: MINTED.epoch, ...input, tripId: "u" })).toBeNull();
  });

  it("course preview", async () => {
    const m = await import("./course-preview-gate");
    const now = 1_800_000_000_000;
    expect(m.signCoursePreview("shop", "course", now)).toBe(MINTED.preview);
    expect(m.coursePreviewIsValid(MINTED.preview, "shop", "course", now)).toBe(true);
    expect(m.coursePreviewIsValid(`${MINTED.preview.slice(0, -1)}é`, "shop", "course", now)).toBe(
      false,
    );
    expect(m.coursePreviewIsValid(MINTED.preview, "shop", "other", now)).toBe(false);
  });

  it("today catch-up", async () => {
    const m = await import("./today-catch-up-token");
    expect(m.signTodayCatchUp(CATCH_UP_SCOPE, [BOOKING])).toBe(MINTED.catchUp);
    expect(m.verifyTodayCatchUp(MINTED.catchUp, CATCH_UP_SCOPE)).toEqual([BOOKING]);
    expect(m.verifyTodayCatchUp(`${MINTED.catchUp.slice(0, -1)}é`, CATCH_UP_SCOPE)).toBeNull();
    expect(m.verifyTodayCatchUp(MINTED.catchUp.slice(0, -1), CATCH_UP_SCOPE)).toBeNull();
  });

  it("schedule move result", async () => {
    const m = await import("./schedule-move-result");
    expect(m.signScheduleMoveResult("shop", BOOKING, 2)).toBe(MINTED.move);
    expect(m.verifyScheduleMoveResult(MINTED.move, "shop")).toEqual({
      id: BOOKING,
      gearReleased: 2,
    });
    expect(m.verifyScheduleMoveResult(`${MINTED.move.slice(0, -1)}é`, "shop")).toBeNull();
    expect(m.verifyScheduleMoveResult(MINTED.move.slice(0, -1), "shop")).toBeNull();
    expect(m.verifyScheduleMoveResult(MINTED.move, "other")).toBeNull();
  });

  it("demo seat", async () => {
    const m = await import("./demo-seat");
    const now = 1_800_000_000_000;
    expect(m.isDemoSeatFor(MINTED.seat, "shop", now)).toBe(true);
    expect(m.isDemoSeatFor(MINTED.seat, "other", now)).toBe(false);
    expect(m.isDemoSeatFor(`${MINTED.seat.slice(0, -1)}A`, "shop", now)).toBe(false);
    expect(m.isDemoSeatFor(`${MINTED.seat.slice(0, -1)}é`, "shop", now)).toBe(false);
  });

  it("demo shop name", async () => {
    const m = await import("./demo-shop-name");
    const now = 1_800_000_000_000;
    expect(m.signDemoShopName("shop", "Blue Reef", now)).toBe(MINTED.name);
    expect(m.demoShopNameFor(MINTED.name, "shop", now)).toBe("Blue Reef");
    expect(m.demoShopNameFor(MINTED.name, "other", now)).toBeNull();
    expect(m.demoShopNameFor(`${MINTED.name.slice(0, -1)}A`, "shop", now)).toBeNull();
  });

  it("quiet demo device", async () => {
    const m = await import("./quiet-demo-device");
    expect(m.quietDemoToken(QUIET_ENV)).toBe(MINTED.quiet);
    expect(m.isQuietDemoDevice(MINTED.quiet, QUIET_ENV)).toBe(true);
    expect(m.isQuietDemoDevice(`${MINTED.quiet.slice(0, -1)}é`, QUIET_ENV)).toBe(false);
    expect(m.isQuietDemoDevice(MINTED.quiet.slice(0, -1), QUIET_ENV)).toBe(false);
  });
});
