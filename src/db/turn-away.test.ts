import { and, count, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { turnAwayReasons } from "@/lib/turn-away";
import { fileScopedShopContext } from "@/test/db";
import { moveBooking, splitBookingIdentity } from "./bookings";
import { listCheckInQueue } from "./check-in";
import { getTripManifest, recordRollCall } from "./manifests";
import { markBookingNoShow, undoBookingNoShow } from "./no-show";
import { getBookingReadiness } from "./readiness";
import {
  activityEvents,
  bookingArrivalEvents,
  bookingPayments,
  bookings,
  orders,
  people,
  shops,
  trips,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { turnBookingAway } from "./turn-away";
import { completeWaiver, issueWaiverRequest } from "./waivers";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();

/**
 * **"Turned away" at the desk** (safety sheet 2026-10-15, item 6; H-20261015-who-may-turn-someone): any
 * active staff member, blocked rows only, one reason from the row's own
 * blockers, and the seat freed once. Every refusal below is a write a hostile
 * or confused caller could post straight at the action, so each is proven here
 * against the writer rather than trusted to the door that draws the button.
 */
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
    personId: seat.person.id,
    personName: seat.person.fullName,
    /** An hour before the boat: "Not here" is still closed, this is open. */
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

async function turnedAwayAt(db: Ctx["db"], bookingId: string) {
  const [row] = await db
    .select({ at: bookings.turnedAwayAt, tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row;
}

/** The seat attached to its diver on a guess, booked under another name (H-20260724-one-person-per-email). */
async function holdSeat(ctx: Ctx, bookedAs = "Sam Stranger") {
  await ctx.db
    .update(bookings)
    .set({
      identityUnconfirmedAt: ctx.now,
      identityBookedAs: bookedAs,
      identityMatchedBy: "shared_email",
    })
    .where(eq(bookings.id, ctx.bookingId));
}

async function heldSeats(db: Ctx["db"], tripId: string) {
  const [row] = await db
    .select({ seats: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), inArray(bookings.status, [...SEAT_HELD_STATUSES])));
  return row?.seats ?? 0;
}

/** The seat's release lines; the seeded demo trail on the same seat is not this test's. */
async function trailCodes(db: Ctx["db"], bookingId: string) {
  return db
    .select({ code: activityEvents.code, params: activityEvents.params })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.bookingId, bookingId),
        inArray(activityEvents.code, ["booking_turned_away", "booking_no_show"]),
      ),
    );
}

/** The reasons this seat's live readiness allows, and proof it is blocked. */
async function blockedReasons(ctx: Ctx) {
  const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.bookingId);
  if (!readiness) throw new Error("readiness missing");
  expect(readiness.status).toBe("blocked");
  return turnAwayReasons(readiness);
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

describe("turnBookingAway", () => {
  it("frees the seat before the boat leaves and writes the reason, not the evidence", async () => {
    const ctx = await context();
    const { db, shop, trip, staffId, bookingId, personName, now } = ctx;
    // The seeded seat has no release on file: blocked, and for the waiver.
    expect(await blockedReasons(ctx)).toContain("waiver");
    const before = await heldSeats(db, trip.id);
    const [moneyBefore] = await db.select({ rows: count() }).from(bookingPayments);
    const [ordersBefore] = await db.select({ rows: count() }).from(orders);

    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: staffId,
        now,
      }),
    ).toEqual({ ok: true, bookingId, tripId: trip.id, personName, reason: "waiver" });

    expect(await seatRow(db, bookingId)).toEqual({ status: "no_show", reason: "waiver" });
    expect(await heldSeats(db, trip.id)).toBe(before - 1);
    const trail = await trailCodes(db, bookingId);
    expect(trail).toEqual([
      {
        code: "booking_turned_away",
        params: expect.objectContaining({ diver: personName, reason: "waiver" }),
      },
    ]);
    // Exactly three names on the line: no answer, no card detail rides along.
    expect(Object.keys(trail[0]?.params as object).sort()).toEqual(["actor", "diver", "reason"]);
    // Not a check-in: the arrival trail is untouched. And no money moved.
    expect(
      await db
        .select({ rows: count() })
        .from(bookingArrivalEvents)
        .where(eq(bookingArrivalEvents.bookingId, bookingId)),
    ).toEqual([{ rows: 0 }]);
    expect(await db.select({ rows: count() }).from(bookingPayments)).toEqual([moneyBefore]);
    expect(await db.select({ rows: count() }).from(orders)).toEqual([ordersBefore]);
  });

  it("is told apart from a no-show on the counter's own row", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    const rows = await listCheckInQueue(db, shop.id, { now, tripId: trip.id });
    const row = rows.find((candidate) => candidate.bookingId === bookingId);
    expect(row).toMatchObject({ bookingStatus: "no_show", turnedAwayReason: "waiver" });
  });

  /** H-20261015-who-may-turn-someone: blocked rows only. A cleared diver has nothing to be turned away for. */
  it("refuses a row readiness clears, whatever the caller posts", async () => {
    const ctx = await context();
    await signWaiver(ctx);
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.bookingId);
    expect(readiness?.status).toBe("ready");
    expect(
      await turnBookingAway(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        reason: "waiver",
        recordedByPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toEqual({ ok: false, reason: "not_blocked" });
    expect(await seatRow(ctx.db, ctx.bookingId)).toEqual({ status: "booked", reason: null });
  });

  it("refuses a reason that is not among the row's own blockers", async () => {
    const ctx = await context();
    expect(await blockedReasons(ctx)).not.toContain("medical");
    expect(
      await turnBookingAway(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        reason: "medical",
        recordedByPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toEqual({ ok: false, reason: "reason_not_blocking" });
    expect(await seatRow(ctx.db, ctx.bookingId)).toEqual({ status: "booked", reason: null });
    expect(await trailCodes(ctx.db, ctx.bookingId)).toEqual([]);
  });

  it("frees the seat exactly once, however the second tap arrives", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    const before = await heldSeats(db, trip.id);
    const input = {
      shopId: shop.id,
      bookingId,
      reason: "waiver" as const,
      recordedByPersonId: staffId,
      now,
    };
    expect(await turnBookingAway(db, input)).toMatchObject({ ok: true });
    expect(await turnBookingAway(db, input)).toEqual({ ok: false, reason: "already_marked" });
    // A "Not here" landing after it is refused too, and changes nothing.
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        now: new Date(trip.startsAt.getTime() + 10 * MINUTE_MS),
      }),
    ).toEqual({ ok: false, reason: "already_marked" });
    expect(await heldSeats(db, trip.id)).toBe(before - 1);
    expect(await seatRow(db, bookingId)).toEqual({ status: "no_show", reason: "waiver" });
    expect((await trailCodes(db, bookingId)).map((row) => row.code)).toEqual([
      "booking_turned_away",
    ]);
  });

  it("refuses a seat already marked not here, and leaves it a no-show", async () => {
    const { db, shop, trip, staffId, bookingId } = await context();
    const after = new Date(trip.startsAt.getTime() + 10 * MINUTE_MS);
    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId,
      recordedByPersonId: staffId,
      now: after,
    });
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: staffId,
        now: after,
      }),
    ).toEqual({ ok: false, reason: "already_marked" });
    expect(await seatRow(db, bookingId)).toEqual({ status: "no_show", reason: null });
  });

  it("refuses a recorder who is not this shop's active staff", async () => {
    const { db, shop, bookingId, personId, now } = await context();
    // The diver themselves.
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: personId,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    // Another shop's person, however they got the id.
    const { stranger } = await otherTenant(db, now, "other-reef-turn-away-staff");
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: stranger.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
  });

  /** Another tenant's seat is not found, never refused on its merits. */
  it("never reaches across shops", async () => {
    const { db, shop, staffId, now } = await context();
    const { seat } = await otherTenant(db, now, "other-reef-turn-away");
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId: seat.id,
        reason: "waiver",
        recordedByPersonId: staffId,
        now,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await seatRow(db, seat.id)).toEqual({ status: "booked", reason: null });
  });

  /** The same first refusal as "Not here": the crew say this diver went to sea. */
  it("refuses a diver the crew recorded not back aboard after a dive", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: staffId,
        now,
      }),
    ).toEqual({ ok: false, reason: "already_missing_after_dive" });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
  });

  it("refuses outside the counter's reach", async () => {
    const { db, shop, trip, staffId, bookingId } = await context();
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: staffId,
        now: new Date(trip.startsAt.getTime() + 7 * HOUR_MS),
      }),
    ).toEqual({ ok: false, reason: "outside_window" });
  });

  /** "Put back on the list" undoes it, and the seat comes back with no reason. */
  it("is undone by putting the diver back, which clears the reason", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    const before = await heldSeats(db, trip.id);
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    expect(
      await undoBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
    expect(await heldSeats(db, trip.id)).toBe(before);
  });

  /**
   * The rail outranks the desk: the crew recording this diver not back aboard
   * after a dive takes the released seat back, and the reason goes with it
   * (`reclaimReleasedSeat`, src/db/manifests.ts). Without the clear, the
   * schema's check would refuse the boarding write itself.
   */
  it("gives the seat back with no reason when the crew say the diver sailed", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
  });

  /** The schema refuses a reason on a seat that is on the boat. */
  it("cannot leave a reason on a seat that holds a place", async () => {
    const { db, bookingId } = await context();
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(bookings)
          .set({ turnedAwayReason: "card" })
          .where(eq(bookings.id, bookingId));
      }),
    ).rejects.toThrow();
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
  });
});

/** Layer 3 review fixes (dde-1, dde-2, security; 2026-10-16). */
describe("turnBookingAway, after review", () => {
  it("records when the desk turned the diver away, beside the reason", async () => {
    const { db, shop, staffId, bookingId, now } = await context();
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    expect((await turnedAwayAt(db, bookingId))?.at).toEqual(now);
  });

  /** dde-1 F1: once the boat has left with an arrived diver, the desk has no door. */
  it("refuses an arrived diver once the boat has sailed, and frees nothing", async () => {
    const { db, shop, trip, staffId, bookingId } = await context();
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    const before = await heldSeats(db, trip.id);
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: staffId,
        now: new Date(trip.startsAt.getTime() + 2 * HOUR_MS),
      }),
    ).toEqual({ ok: false, reason: "sailed" });
    expect(await seatRow(db, bookingId)).toEqual({ status: "checked_in", reason: null });
    expect(await heldSeats(db, trip.id)).toBe(before);
  });

  /**
   * Security F1: a held seat's other blockers are the matched person's. Only
   * the identity question (and the seat's payment) may be the reason, and the
   * trail names the person the seat was booked as, never the matched diver.
   */
  it("takes only the seat's own reason on a held seat, and names the booked-as name", async () => {
    const ctx = await context();
    await holdSeat(ctx);
    const input = {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingId,
      recordedByPersonId: ctx.staffId,
      now: ctx.now,
    };
    // The matched person's missing release is not this seat's to give.
    expect(await turnBookingAway(ctx.db, { ...input, reason: "waiver" })).toEqual({
      ok: false,
      reason: "reason_not_blocking",
    });
    expect(await turnBookingAway(ctx.db, { ...input, reason: "identity" })).toMatchObject({
      ok: true,
      personName: "Sam Stranger",
      reason: "identity",
    });
    const [line] = await trailCodes(ctx.db, ctx.bookingId);
    expect(line?.params).toMatchObject({ diver: "Sam Stranger", reason: "identity" });
    expect(JSON.stringify(line?.params)).not.toContain(ctx.personName);
  });

  /** Security F1, the same one-line fix on "Not here". */
  it("names the booked-as name when a held seat is marked not here", async () => {
    const ctx = await context();
    await holdSeat(ctx);
    expect(
      await markBookingNoShow(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        now: new Date(ctx.trip.startsAt.getTime() + 10 * MINUTE_MS),
      }),
    ).toMatchObject({ ok: true, personName: "Sam Stranger" });
    const [line] = await trailCodes(ctx.db, ctx.bookingId);
    expect(line?.params).toMatchObject({ diver: "Sam Stranger" });
  });

  /**
   * Security F1: a split hands the seat to the person who was really there.
   * The category was chosen about the guess, so it goes; the fact that the
   * desk turned somebody away stays.
   */
  it("clears the reason on a split and keeps the turn-away", async () => {
    const ctx = await context();
    await holdSeat(ctx);
    await turnBookingAway(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingId,
      reason: "identity",
      recordedByPersonId: ctx.staffId,
      now: ctx.now,
    });
    expect(
      await splitBookingIdentity(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        actorPersonId: ctx.staffId,
        fullName: "Sam Stranger",
        adultAttested: true,
      }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(ctx.db, ctx.bookingId)).toEqual({ status: "no_show", reason: null });
    expect((await turnedAwayAt(ctx.db, ctx.bookingId))?.at).toEqual(ctx.now);
  });

  /**
   * dde-2 #3: "Move their booking" is a door that works. The seat is booked
   * on the new departure, the turn-away goes with the old one, and the money
   * and any package dive ride on the booking row as on any move.
   */
  it("moves a turned-away seat to another departure as a booked seat", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    const [target] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Another Reef Run",
        startsAt: new Date(trip.startsAt.getTime() + 48 * HOUR_MS),
        endsAt: new Date(trip.startsAt.getTime() + 52 * HOUR_MS),
        capacity: 6,
      })
      .returning();
    if (!target) throw new Error("target trip insert failed");
    expect(
      await moveBooking(db, {
        shopId: shop.id,
        fromTripId: trip.id,
        toTripId: target.id,
        bookingId,
        now,
      }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
    expect(await turnedAwayAt(db, bookingId)).toEqual({ at: null, tripId: target.id });
  });

  it("still refuses to move a plain no-show", async () => {
    const { db, shop, trip, staffId, bookingId } = await context();
    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId,
      recordedByPersonId: staffId,
      now: new Date(trip.startsAt.getTime() + 10 * MINUTE_MS),
    });
    const [target] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Another Reef Run",
        startsAt: new Date(trip.startsAt.getTime() + 48 * HOUR_MS),
        endsAt: new Date(trip.startsAt.getTime() + 52 * HOUR_MS),
        capacity: 6,
      })
      .returning();
    if (!target) throw new Error("target trip insert failed");
    expect(
      await moveBooking(db, {
        shopId: shop.id,
        fromTripId: trip.id,
        toTripId: target.id,
        bookingId,
        now: new Date(trip.startsAt.getTime() - HOUR_MS),
      }),
    ).toEqual({ ok: false, reason: "not_movable" });
  });

  /**
   * dde-1 F2: the diver signs on the dock and walks aboard after the desk
   * sold their seat. The rail never refuses a body it can see (the reclaim
   * has no capacity check, by design); the boat being over is *said*, on the
   * manifest's over-capacity count. Flagged, not refused: refusing would leave
   * a person aboard whom the manifest does not carry.
   */
  it("takes a turned-away seat back at the rail on a sold boat, and the manifest says over", async () => {
    const ctx = await context();
    const { db, shop, trip, staffId, bookingId, now } = ctx;
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    await signWaiver(ctx);
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
    expect((await turnedAwayAt(db, bookingId))?.at).toBeNull();
    let aboard = 1;
    for (const row of await getTripRoster(db, shop.id, trip.id)) {
      if (row.booking.id === bookingId) continue;
      const boarded = await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: row.booking.id,
        recordedByPersonId: staffId,
        status: "boarded",
      });
      if (boarded.ok) aboard += 1;
    }
    // The walk-in holds the seat the desk freed: the boat sells one fewer
    // than the crew have counted aboard.
    await db
      .update(trips)
      .set({ capacity: aboard - 1 })
      .where(eq(trips.id, trip.id));
    expect((await getTripManifest(db, shop.id, trip.id))?.summary.overCapacity).toBe(1);
  });
});

/**
 * Layer 3 second review (dde-3, 2026-10-16). Each boundary is tested at the
 * edge itself: exactly the scheduled start, exactly a full boat.
 */
describe("turnBookingAway, second review", () => {
  const atStart = (ctx: Ctx, minutes: number) =>
    new Date(ctx.trip.startsAt.getTime() + minutes * MINUTE_MS);

  /** #1: an arrived diver is presumed aboard from the scheduled start, not an hour after. */
  it("refuses an arrived diver from the scheduled start", async () => {
    const ctx = await context();
    const { db, shop, staffId, bookingId } = ctx;
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    for (const minutes of [0, 10, 59]) {
      expect(
        await turnBookingAway(db, {
          shopId: shop.id,
          bookingId,
          reason: "waiver",
          recordedByPersonId: staffId,
          now: atStart(ctx, minutes),
        }),
      ).toEqual({ ok: false, reason: "sailed" });
    }
    expect(await seatRow(db, bookingId)).toEqual({ status: "checked_in", reason: null });
    // The control: a minute before the boat, the desk can still refuse them.
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason: "waiver",
        recordedByPersonId: staffId,
        now: atStart(ctx, -1),
      }),
    ).toMatchObject({ ok: true });
  });

  /**
   * #2: turned away at 07:40, Undo at 09:30 used to restore `checked_in` from
   * the arrival trail: a diver ashore shown aboard, and missing at the rail.
   */
  it("refuses to put a turned-away diver back once the boat's start has passed", async () => {
    const ctx = await context();
    const { db, shop, trip, staffId, bookingId } = ctx;
    await db.update(bookings).set({ status: "checked_in" }).where(eq(bookings.id, bookingId));
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now: atStart(ctx, -20),
    });
    const before = await heldSeats(db, trip.id);
    for (const minutes of [0, 90]) {
      expect(
        await undoBookingNoShow(db, {
          shopId: shop.id,
          bookingId,
          recordedByPersonId: staffId,
          now: atStart(ctx, minutes),
        }),
      ).toEqual({ ok: false, reason: "turned_away_departed" });
    }
    expect(await seatRow(db, bookingId)).toEqual({ status: "no_show", reason: "waiver" });
    expect(await heldSeats(db, trip.id)).toBe(before);
    // The control: a minute before the boat, the desk can take it back.
    expect(
      await undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        now: atStart(ctx, -1),
      }),
    ).toMatchObject({ ok: true });
  });

  /** #2's scope: a plain "Not here" is still undone as the lines come off. */
  it("still puts a plain no-show back after the start", async () => {
    const ctx = await context();
    const { db, shop, staffId, bookingId } = ctx;
    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId,
      recordedByPersonId: staffId,
      now: atStart(ctx, 5),
    });
    expect(
      await undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        now: atStart(ctx, 30),
      }),
    ).toMatchObject({ ok: true });
  });

  /**
   * #4 and #5 (orchestrator default): a turned-away seat moves only before
   * the source's scheduled start. After it, the door is Remove, and the
   * turn-away stays on the record.
   */
  it("moves a turned-away seat only before the boat's start", async () => {
    const ctx = await context();
    const { db, shop, trip, staffId, bookingId } = ctx;
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now: atStart(ctx, -30),
    });
    const [target] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Another Reef Run",
        startsAt: new Date(trip.startsAt.getTime() + 48 * HOUR_MS),
        endsAt: new Date(trip.startsAt.getTime() + 52 * HOUR_MS),
        capacity: 6,
      })
      .returning();
    if (!target) throw new Error("target trip insert failed");
    const move = (now: Date) =>
      moveBooking(db, {
        shopId: shop.id,
        fromTripId: trip.id,
        toTripId: target.id,
        bookingId,
        now,
      });
    for (const minutes of [0, 120]) {
      expect(await move(atStart(ctx, minutes))).toEqual({ ok: false, reason: "departed" });
    }
    expect(await turnedAwayAt(db, bookingId)).toEqual({ at: atStart(ctx, -30), tripId: trip.id });
    expect(await move(atStart(ctx, -1))).toMatchObject({ ok: true });
  });

  /**
   * #6 (orchestrator default): at the departure checkpoint, Boarded on a
   * turned-away seat whose place the desk has since sold is refused; the
   * after-dive head count never is.
   */
  it("refuses a departure boarding that would put the boat over, never an after-dive one", async () => {
    const ctx = await context();
    const { db, shop, trip, staffId, bookingId, now } = ctx;
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    await signWaiver(ctx);
    // Exactly full without them: the freed seat was sold.
    const held = await heldSeats(db, trip.id);
    await db.update(trips).set({ capacity: held }).where(eq(trips.id, trip.id));
    const board = (checkpoint?: "after_dive_1") =>
      recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint,
      });
    expect(await board()).toEqual({ ok: false, reason: "boat_full" });
    expect(await seatRow(db, bookingId)).toEqual({ status: "no_show", reason: "waiver" });
    // Offline, the same tap synced later is refused the same way.
    const synced = nowMs();
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
        source: "offline",
        clientEventId: "dddddddd-3333-4333-8333-dddddddddddd",
        offlineSnapshotSavedAt: new Date(synced - 2 * HOUR_MS),
        occurredAt: new Date(synced - HOUR_MS),
      }),
    ).toEqual({ ok: false, reason: "boat_full" });
    expect(await seatRow(db, bookingId)).toEqual({ status: "no_show", reason: "waiver" });
    // A head count after a dive is never refused: the body is on the boat.
    expect(await board("after_dive_1")).toMatchObject({ ok: true });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
  });

  it("takes a turned-away seat back at departure while one place is free", async () => {
    const ctx = await context();
    const { db, shop, trip, staffId, bookingId, now } = ctx;
    await turnBookingAway(db, {
      shopId: shop.id,
      bookingId,
      reason: "waiver",
      recordedByPersonId: staffId,
      now,
    });
    await signWaiver(ctx);
    const held = await heldSeats(db, trip.id);
    await db
      .update(trips)
      .set({ capacity: held + 1 })
      .where(eq(trips.id, trip.id));
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });
    expect(await seatRow(db, bookingId)).toEqual({ status: "booked", reason: null });
  });
});

/** A second shop with a departure, a diver and a seat of its own. */
async function otherTenant(db: Ctx["db"], now: Date, slug: string) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Other Reef", slug, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("other shop insert failed");
  const [stranger] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Someone Else" })
    .returning();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Their Reef Run",
      startsAt: new Date(now.getTime() + 10 * MINUTE_MS),
      endsAt: new Date(now.getTime() + 4 * 60 * MINUTE_MS),
      capacity: 6,
    })
    .returning();
  if (!stranger || !trip) throw new Error("other tenant fixture failed");
  const [seat] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: stranger.id })
    .returning();
  if (!seat) throw new Error("other tenant booking failed");
  return { shop, stranger, trip, seat };
}
