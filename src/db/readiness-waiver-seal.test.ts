import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { getBookingReadiness, listTripReadiness, upsertTripRequirements } from "./readiness";
import { waiverRecords } from "./schema";
import { WAIVER_SEALED_COLUMNS } from "./waiver-record-columns";
import { acknowledgeBrokenWaiverSeal, waiverSealStateDigest } from "./waiver-seal-acknowledgements";
import { recheckWaiverSeals } from "./waiver-seal-checks";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  recordMedicalEvaluationForShop,
  waiverContextFor,
} from "./waivers-test-fixtures";

/**
 * **A release changed after signing does not board** (issue #3885), end to
 * end: the seal the signature wrote, the nightly re-check that reads it, and
 * the readiness both the booking and the manifest's roster read.
 */
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);
// After every seeded and signed check time, so the pass reads the row.
const nightly = new Date("2099-01-01T00:00:00.000Z");

async function signedOnAWaiverOnlyTrip(answers: typeof clearAnswers) {
  const ctx = await waiverContext();
  const { db, shop, trip, booking, person } = ctx;
  await upsertTripRequirements(db, {
    shopId: shop.id,
    tripId: trip.id,
    requiresWaiver: true,
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: false,
  });
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.key, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: answers,
  });
  if (!done.ok) throw new Error("completion failed");
  return { ...ctx, recordId: issued.recordId };
}

async function seatCodes(ctx: Awaited<ReturnType<typeof signedOnAWaiverOnlyTrip>>) {
  const { db, shop, trip, booking } = ctx;
  const one = await getBookingReadiness(db, shop.id, booking.id);
  const roster = await listTripReadiness(db, shop.id, trip.id);
  const row = roster.find((entry) => entry.booking.id === booking.id);
  // The manifest's roster and the booking read one engine: never two answers.
  expect(row?.readiness).toEqual(one);
  return { status: one?.status, codes: one?.blockers.map((blocker) => blocker.code) ?? [] };
}

describe("readiness over a release whose seal failed", () => {
  it("is ready on a clean release whose seal holds through the nightly check", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(clearAnswers);
    await recheckWaiverSeals(ctx.db, { now: nightly });
    expect(await seatCodes(ctx)).toEqual({ status: "ready", codes: [] });
  });

  it("holds a diver whose medical yes was turned to no after signing", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    expect((await seatCodes(ctx)).codes).toContain("medical_review");

    // The edit nobody should be able to make: the referral is rewritten as a
    // clean release straight in the database.
    await ctx.db
      .update(waiverRecords)
      .set({ medicalAnswers: clearAnswers, status: "completed", medicalReviewRequired: false })
      .where(eq(waiverRecords.id, ctx.recordId));

    const summary = await recheckWaiverSeals(ctx.db, { now: nightly });
    expect(summary.newlyInvalid).toBeGreaterThanOrEqual(1);
    expect(await seatCodes(ctx)).toEqual({ status: "blocked", codes: ["waiver_seal_failed"] });
  });

  it("holds when only the release's text was changed", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(clearAnswers);
    await ctx.db
      .update(waiverRecords)
      .set({ templateBody: "A release nobody agreed to." })
      .where(eq(waiverRecords.id, ctx.recordId));
    await recheckWaiverSeals(ctx.db, { now: nightly });
    expect(await seatCodes(ctx)).toEqual({ status: "blocked", codes: ["waiver_seal_failed"] });
  });

  it("does not take a forged valid verdict back to ready once the next check runs", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(clearAnswers);
    await ctx.db
      .update(waiverRecords)
      .set({ templateBody: "A release nobody agreed to.", integrityValid: true })
      .where(eq(waiverRecords.id, ctx.recordId));
    await recheckWaiverSeals(ctx.db, { now: nightly });
    expect((await seatCodes(ctx)).codes).toEqual(["waiver_seal_failed"]);
  });

  // Attacker review B1: the tampered referral stops being the release the seat
  // reads (flipped back to pending), and the person is still held on it.
  it("holds a diver whose changed referral is no longer the release the seat reads", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    await ctx.db
      .update(waiverRecords)
      .set({ status: "pending" })
      .where(eq(waiverRecords.id, ctx.recordId));
    await recheckWaiverSeals(ctx.db, { now: nightly });
    expect((await seatCodes(ctx)).codes).toContain("waiver_seal_failed");
  });

  it("lets a clean signature made after the failed check clear the hold", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(clearAnswers);
    await ctx.db
      .update(waiverRecords)
      .set({ templateBody: "A release nobody agreed to." })
      .where(eq(waiverRecords.id, ctx.recordId));
    await recheckWaiverSeals(ctx.db, { now: nightly });
    // The check ran before the diver signed again.
    await ctx.db
      .update(waiverRecords)
      .set({ integrityCheckedAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(waiverRecords.id, ctx.recordId));
    const again = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
    });
    if (!again.ok) throw new Error(`issue failed: ${again.reason}`);
    const done = await completeWaiver(ctx.db, again.key, {
      signerName: ctx.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
    });
    if (!done.ok) throw new Error("completion failed");
    expect(await seatCodes(ctx)).toEqual({ status: "ready", codes: [] });
  });

  /**
   * **An acknowledgement is not a repair** (#3891; layer-2 dock review S4).
   * A manager recording that they looked into a broken release quietens the
   * nightly alarm, never the rail: the diver stays held until they sign again.
   */
  it("still holds the diver after a manager acknowledges the broken seal", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(clearAnswers);
    await ctx.db
      .update(waiverRecords)
      .set({ templateBody: "A release nobody agreed to." })
      .where(eq(waiverRecords.id, ctx.recordId));
    await recheckWaiverSeals(ctx.db, { now: nightly });
    const [row] = await ctx.db
      .select({ record: WAIVER_SEALED_COLUMNS })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, ctx.recordId));
    if (!row) throw new Error("record missing");
    const owner = await seededStaffPersonId(ctx.db, ctx.shop.id, SEEDED_OWNER_EMAIL);
    expect(
      await acknowledgeBrokenWaiverSeal(ctx.db, {
        shopId: ctx.shop.id,
        recordId: ctx.recordId,
        actorPersonId: owner,
        note: "Looked into it; the diver will sign again at the desk.",
        expectedStateDigest: waiverSealStateDigest(row.record),
        now: nightly,
      }),
    ).toEqual({ ok: true });
    await recheckWaiverSeals(ctx.db, { now: new Date(nightly.getTime() + 86_400_000) });
    expect(await seatCodes(ctx)).toEqual({ status: "blocked", codes: ["waiver_seal_failed"] });
  });
});

/**
 * **A recorded clearance counts** (Aaron, 2026-11-06, under the ux-over-hardening rule): the
 * physician's answer has no seal of its own. A clearance stamp names the staffer who recorded it
 * and the evaluation date (`waiver_records_medical_clearance_attributed` and `_evidenced`), and
 * that record is what lifts the referral, however the row was written. No recorded clearance, no
 * boarding.
 */
describe("readiness over a physician's answer", () => {
  async function clearAtTheDesk(ctx: Awaited<ReturnType<typeof signedOnAWaiverOnlyTrip>>) {
    const owner = await seededStaffPersonId(ctx.db, ctx.shop.id, SEEDED_OWNER_EMAIL);
    const result = await recordMedicalEvaluationForShop(ctx.db, {
      outcome: "cleared",
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      recordedByPersonId: owner,
      evaluatedOn: calendarDateInTimezone(nowDate(), ctx.shop.timezone),
      physicianName: "Dr. Imani Reyes",
    });
    expect(result).toMatchObject({ ok: true, alreadyRecorded: false });
    return owner;
  }

  it("holds a referral no physician has answered", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    const seat = await seatCodes(ctx);
    expect(seat.status).toBe("blocked");
    expect(seat.codes).toContain("medical_review");
  });

  it("boards a referral a physician cleared at the desk, through the nightly check", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    await clearAtTheDesk(ctx);
    const summary = await recheckWaiverSeals(ctx.db, { now: nightly });
    expect(summary.invalid).toBe(0);
    expect(await seatCodes(ctx)).toEqual({ status: "ready", codes: [] });
  });

  it("boards a diver whose recorded clearance was written outside the desk's form", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    const owner = await seededStaffPersonId(ctx.db, ctx.shop.id, SEEDED_OWNER_EMAIL);
    await ctx.db
      .update(waiverRecords)
      .set({
        medicalClearedAt: nowDate(),
        medicalClearedByPersonId: owner,
        medicalClearanceEvaluatedOn: calendarDateInTimezone(nowDate(), ctx.shop.timezone),
        medicalClearancePhysicianName: "Dr. Imani Reyes",
      })
      .where(eq(waiverRecords.id, ctx.recordId));
    expect(await seatCodes(ctx)).toEqual({ status: "ready", codes: [] });
    // The nightly check reads the signature, not the answer: still ready.
    const summary = await recheckWaiverSeals(ctx.db, { now: nightly });
    expect(summary.invalid).toBe(0);
    expect(await seatCodes(ctx)).toEqual({ status: "ready", codes: [] });
  });

  it("holds a diver whose physician said no", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    const owner = await seededStaffPersonId(ctx.db, ctx.shop.id, SEEDED_OWNER_EMAIL);
    const refused = await recordMedicalEvaluationForShop(ctx.db, {
      outcome: "not_cleared",
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      recordedByPersonId: owner,
      evaluatedOn: calendarDateInTimezone(nowDate(), ctx.shop.timezone),
      physicianName: "Dr. Imani Reyes",
    });
    expect(refused).toMatchObject({ ok: true });
    expect((await seatCodes(ctx)).status).toBe("blocked");
  });

  it("refuses a clearance stamp that names no staffer", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    await expect(
      ctx.db
        .update(waiverRecords)
        .set({
          medicalClearedAt: nowDate(),
          medicalClearanceEvaluatedOn: calendarDateInTimezone(nowDate(), ctx.shop.timezone),
          medicalClearancePhysicianName: "Dr. Imani Reyes",
        })
        .where(eq(waiverRecords.id, ctx.recordId)),
    ).rejects.toThrow();
  });

  // supersededAt is outside the seal on purpose: superseding moves a hold
  // off a seat and answers nothing, so a referral keeps holding by time.
  it("still holds a diver whose own referral was superseded straight in the database", async () => {
    const ctx = await signedOnAWaiverOnlyTrip(medicalReferralAnswers);
    await ctx.db
      .update(waiverRecords)
      .set({ supersededAt: nowDate() })
      .where(eq(waiverRecords.id, ctx.recordId));
    await recheckWaiverSeals(ctx.db, { now: nightly });
    const seat = await seatCodes(ctx);
    expect(seat.status).toBe("blocked");
    expect(seat.codes).toContain("medical_review");
  });
});
