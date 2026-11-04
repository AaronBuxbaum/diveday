import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { recordRollCall } from "./manifests";
import { undoBookingNoShow } from "./no-show";
import { bookingArrivalEvents, bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { turnBookingAway } from "./turn-away";
import { completeWaiver, issueWaiverRequest } from "./waivers";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`). The rest of the turn-away writer
// is `turn-away.test.ts`'s.
const fileCtx = fileScopedShopContext();

async function context() {
  const { db, shop } = fileCtx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => candidate.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("seeded reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded staff missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  if (!seat) throw new Error("seeded booking missing");
  return {
    db,
    shop,
    trip,
    staffId: staff.person.id,
    bookingId: seat.booking.id,
    personName: seat.person.fullName,
    /** An hour before the boat: "Not here" is still closed, turning away is open. */
    now: new Date(trip.startsAt.getTime() - HOUR_MS),
  };
}

type Ctx = Awaited<ReturnType<typeof context>>;

async function seatRow(db: Ctx["db"], bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status, reason: bookings.turnedAwayReason })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row;
}

async function signWaiver(ctx: Ctx) {
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!issued.ok) throw new Error("waiver request refused");
  await completeWaiver(ctx.db, issued.token, {
    signerName: ctx.personName,
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
}

/**
 * Issue #3686, item 1: the desk turning a diver away is a statement that the
 * diver is not checked in for this boat. Until it wrote a `cleared` arrival,
 * the standing `arrived` row outlived it, and a desk undo or a crew Boarded tap
 * put the diver back `checked_in`: the desk's check-in, which readiness had
 * just refused, restored with nobody saying it again.
 */
describe("turnBookingAway, the arrival trail", () => {
  async function checkedInThenTurnedAway(ctx: Ctx) {
    const { db, shop, trip, staffId, bookingId, now } = ctx;
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    await db.insert(bookingArrivalEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId,
      recordedByPersonId: staffId,
      status: "arrived",
      occurredAt: new Date(now.getTime() - 10 * MINUTE_MS),
    });
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: staffId,
        now,
      }),
    ).toMatchObject({ ok: true });
  }

  async function arrivalTrail(db: Ctx["db"], bookingId: string) {
    return db
      .select({
        status: bookingArrivalEvents.status,
        recordedBy: bookingArrivalEvents.recordedByPersonId,
      })
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, bookingId))
      .orderBy(bookingArrivalEvents.seq);
  }

  it("clears a standing check-in, in the staffer's name", async () => {
    const ctx = await context();
    await checkedInThenTurnedAway(ctx);
    expect(await arrivalTrail(ctx.db, ctx.bookingId)).toEqual([
      { status: "arrived", recordedBy: ctx.staffId },
      { status: "cleared", recordedBy: ctx.staffId },
    ]);
  });

  it("writes no arrival for a diver the desk never checked in", async () => {
    const { db, shop, staffId, bookingId, now } = await context();
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    expect(await arrivalTrail(db, bookingId)).toEqual([]);
  });

  it("is put back on the list as booked, never checked in", async () => {
    const ctx = await context();
    await checkedInThenTurnedAway(ctx);
    expect(
      await undoBookingNoShow(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(ctx.db, ctx.bookingId)).toEqual({ status: "booked", reason: null });
  });

  it("is taken back at the rail as booked, never checked in", async () => {
    const ctx = await context();
    await checkedInThenTurnedAway(ctx);
    await signWaiver(ctx);
    expect(
      await recordRollCall(ctx.db, {
        shopId: ctx.shop.id,
        tripId: ctx.trip.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(ctx.db, ctx.bookingId)).toEqual({ status: "booked", reason: null });
  });
});
