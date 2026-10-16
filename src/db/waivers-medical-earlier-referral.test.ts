import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { getBookingReadiness, upsertTripRequirements } from "./readiness";
import { activityEvents, bookings, people, waiverRecords } from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver } from "./waivers-completion";
import { earlierReferralForOpenHold, recordMedicalEvaluation } from "./waivers-medical";
import { issueWaiverRequest } from "./waivers-requests";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

/**
 * **A physician's letter for an earlier referral, and the re-signed one**
 * (issue #2616). The diver signs in March and answers yes to a heart question, a
 * physician clears them in April, the shop never records it, the terms change
 * and they re-sign the same "yes" in June, and the desk is handed the April
 * letter in July. The letter predates the newer record's answers, and is refused
 * today. It is accepted only when it covers an earlier, still-open referral
 * that flagged everything the open one does, and is itself inside its year.
 * Every other path keeps the refusal.
 */
describe("a physician's letter that predates a re-signed referral", () => {
  const FIRST = now; // 2026-07-18: the first referral
  const SECOND = new Date("2026-10-16T12:00:00.000Z"); // the re-signed one
  const LETTER_BETWEEN = "2026-08-20";

  const answers = (...ids: string[]) => ({
    ...clearAnswers,
    responses: {
      ...clearAnswers.responses,
      ...Object.fromEntries(ids.map((id) => [id, true])),
    },
  });

  async function signBoth(first: string[], second: string[], secondAt: Date = SECOND) {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: FIRST,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers(...first),
      now: FIRST,
    });
    const again = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: secondAt,
    });
    if (!again.ok) throw new Error("expected a fresh person-scoped link");
    await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers(...second),
      now: secondAt,
    });
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    return { ...context, staff: staff.person };
  }

  async function record(
    ctx: Awaited<ReturnType<typeof signBoth>>,
    evaluatedOn: string,
    at: Date,
    outcome: "cleared" | "not_cleared" = "cleared",
    earlierLetterConfirmed = true,
  ) {
    return recordMedicalEvaluation(ctx.db, {
      earlierLetterConfirmed,
      outcome,
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      recordedByPersonId: ctx.staff.id,
      evaluatedOn,
      physicianName: "Dr. Imani Reyes",
      now: at,
    });
  }

  async function referrals(ctx: Awaited<ReturnType<typeof signBoth>>) {
    const rows = await ctx.db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.personId, ctx.person.id), eq(waiverRecords.status, "medical_review")),
      );
    return rows.sort((a, b) => (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0));
  }

  const TODAY = new Date("2026-10-20T12:00:00.000Z");

  async function earlierLetterEvents(ctx: Awaited<ReturnType<typeof signBoth>>) {
    return ctx.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.code, "medical_answered_by_earlier_letter"));
  }

  it("clears the re-signed referral with the earlier letter, and only that record", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY)).toMatchObject({ ok: true });

    const [first, second] = await referrals(ctx);
    expect(second?.medicalClearedAt).toEqual(TODAY);
    expect(second?.medicalClearanceEvaluatedOn).toBe(LETTER_BETWEEN);
    // The earlier referral is not cleared by the same letter.
    expect(first?.medicalClearedAt).toBeNull();
  });

  it("accepts a letter for an earlier referral that flagged more than the re-signed one", async () => {
    const ctx = await signBoth(["q3", "q5"], ["q3"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY)).toMatchObject({ ok: true });
  });

  it("still refuses when the re-signed referral flags a prompt the earlier one never did", async () => {
    const ctx = await signBoth(["q3"], ["q3", "q5"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY)).toEqual({
      ok: false,
      reason: "evaluation_predates_disclosure",
    });
    const [, second] = await referrals(ctx);
    expect(second?.medicalClearedAt).toBeNull();
  });

  it("still refuses a letter dated before the earliest matching referral", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, "2026-07-17", TODAY)).toEqual({
      ok: false,
      reason: "evaluation_predates_disclosure",
    });
  });

  it("accepts a letter dated the day the earliest matching referral was signed", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, "2026-07-18", TODAY)).toMatchObject({ ok: true });
  });

  it("still refuses a letter older than its own year", async () => {
    const secondAt = new Date("2027-08-01T12:00:00.000Z");
    const ctx = await signBoth(["q3"], ["q3"], secondAt);
    const later = new Date("2027-08-20T12:00:00.000Z");
    expect(await record(ctx, "2026-08-01", later)).toEqual({
      ok: false,
      reason: "evaluation_predates_disclosure",
    });
  });

  it("does not count an earlier referral a physician already answered", async () => {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: FIRST,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers("q3"),
      now: FIRST,
    });
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    // A physician refused the first referral.
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "not_cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.person.id,
        evaluatedOn: "2026-07-19",
        physicianName: "Dr. Imani Reyes",
        now: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).toMatchObject({ ok: true });
    const again = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: SECOND,
    });
    if (!again.ok) throw new Error("expected a fresh person-scoped link");
    await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers("q3"),
      now: SECOND,
    });
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.person.id,
        evaluatedOn: LETTER_BETWEEN,
        physicianName: "Dr. Imani Reyes",
        now: TODAY,
      }),
    ).toEqual({ ok: false, reason: "evaluation_predates_disclosure" });
  });

  it("applies to a refusal the same way, since it is the same act", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY, "not_cleared")).toMatchObject({
      ok: true,
      outcome: "not_cleared",
    });
  });

  it("refuses the earlier letter without the staff confirmation, a clearance and a refusal alike", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    for (const outcome of ["cleared", "not_cleared"] as const) {
      expect(await record(ctx, LETTER_BETWEEN, TODAY, outcome, false)).toEqual({
        ok: false,
        reason: "evaluation_predates_disclosure",
      });
    }
    const [, second] = await referrals(ctx);
    expect(second?.medicalClearedAt).toBeNull();
    expect(second?.medicalClearanceDeclinedAt).toBeNull();
    expect(await earlierLetterEvents(ctx)).toEqual([]);
  });

  it("asks for no confirmation when the letter is dated after the open referral", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, "2026-10-17", TODAY, "cleared", false)).toMatchObject({ ok: true });
    expect(await earlierLetterEvents(ctx)).toEqual([]);
  });

  it("does not count an earlier referral whose seat passed to somebody else", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    const [first] = await referrals(ctx);
    if (!first?.bookingId) throw new Error("expected a first referral on a seat");
    // The seat is claimed by another person: the record keeps the diver's id
    // (it was given under their name) but the booking is no longer theirs.
    const [stranger] = await ctx.db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, ctx.shop.id)))
      .limit(50)
      .then((rows) => rows.filter((row) => row.id !== ctx.person.id));
    if (!stranger) throw new Error("expected another person");
    await ctx.db
      .update(bookings)
      .set({ personId: stranger.id })
      .where(eq(bookings.id, first.bookingId));

    expect(await record(ctx, LETTER_BETWEEN, TODAY)).toEqual({
      ok: false,
      reason: "evaluation_predates_disclosure",
    });
  });

  it("stamps which earlier referral covered the answer on the diver's trail", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    const [first, second] = await referrals(ctx);
    const result = await record(ctx, LETTER_BETWEEN, TODAY);
    expect(result).toMatchObject({ ok: true, earlierLetter: { referralId: first?.id } });

    const events = await earlierLetterEvents(ctx);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: "medical_answered_by_earlier_letter",
      actorPersonId: ctx.staff.id,
      params: expect.objectContaining({
        referral: first?.id,
        record: second?.id,
        evaluated: LETTER_BETWEEN,
        outcome: "cleared",
      }),
    });
  });

  it("answers the open record only, says another seat is still held, and clears both once the letter is recorded there", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    const { db, shop, booking, person, trip } = ctx;
    // The same diver's second seat, on another departure: no record of its own,
    // so it stands on the diver's evidence (the re-signed referral).
    const email = person.email;
    if (!email) throw new Error("demo diver has no email to rebook under");
    const upcoming = await upcomingTripsWithCounts(db, shop.id, nowDate());
    const other = upcoming.find(
      (row) => row.id !== trip.id && !row.course && row.booked < row.capacity,
    );
    if (!other) throw new Error("expected a second open trip in the seed");
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      fullName: person.fullName,
      email,
    });
    if (!second.ok) throw new Error(`second booking failed: ${second.reason}`);
    for (const tripId of [trip.id, other.id]) {
      await upsertTripRequirements(db, {
        shopId: shop.id,
        tripId,
        requiresWaiver: true,
        minimumCertificationLevel: null,
        requiredSpecialties: [],
        requiresNitrox: false,
        requiresPayment: false,
      });
    }
    const blocked = async (bookingId: string) =>
      (await getBookingReadiness(db, shop.id, bookingId))?.blockers.map((b) => b.code) ?? [];
    expect(await blocked(booking.id)).toContain("medical_review");
    expect(await blocked(second.bookingId)).toContain("medical_review");

    const result = await record(ctx, LETTER_BETWEEN, TODAY);
    // The letter answers the re-signed referral, so the seat that stands on it
    // is clear; the seat whose own record is the earlier referral is not, and
    // the desk is told so.
    expect(result).toMatchObject({ ok: true, earlierLetter: { seatsStillHeld: 1 } });
    expect(await blocked(second.bookingId)).not.toContain("medical_review");
    expect(await blocked(booking.id)).toContain("medical_review");

    // Recording the same letter against the earlier referral is the ordinary
    // path (it is dated after that referral), and clears the held seat.
    expect(await record(ctx, LETTER_BETWEEN, TODAY, "cleared", false)).toMatchObject({
      ok: true,
      alreadyRecorded: false,
    });
    expect(await blocked(booking.id)).not.toContain("medical_review");
    expect(await blocked(second.bookingId)).not.toContain("medical_review");
  });

  it("tells the form which earlier referral a letter could cover, and nothing when none does", async () => {
    const covered = await signBoth(["q3"], ["q3"]);
    const [first] = await referrals(covered);
    expect(
      await earlierReferralForOpenHold(covered.db, covered.shop.id, covered.person.id),
    ).toEqual({ referralId: first?.id, on: "2026-07-18" });
  });

  it("offers nothing when the re-signed referral flags a prompt the earlier one never did", async () => {
    const ctx = await signBoth(["q3"], ["q3", "q5"]);
    expect(await earlierReferralForOpenHold(ctx.db, ctx.shop.id, ctx.person.id)).toBeNull();
  });
});
