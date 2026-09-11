import { and, count, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MINUTE_MS } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { seededShopContext } from "@/test/db";
import { recordRollCall } from "./manifests";
import { markBookingNoShow, noShowSalvage, undoBookingNoShow } from "./no-show";
import {
  activityEvents,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  orderLineItems,
  orders,
  paymentOperationIntents,
  people,
  shops,
  trips,
  tripWaitlistEntries,
} from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

/**
 * The first writer of `bookings.status = "no_show"`, and the two things it is
 * not allowed to do: put a diver the crew recorded aboard onto the absent
 * list, and touch money.
 *
 * Written against a fresh database per test rather than the file-scoped
 * transaction helper, because this module's subject *is* transactions —
 * `FOR UPDATE` on the booking and on the trip — and a savepoint inside one
 * outer transaction cannot contend with itself (`src/test/db.ts`).
 */

/** Every table this module must leave alone, in one list (see below). */
const MONEY_TABLES = {
  orders,
  orderLineItems,
  bookingPayments,
  bookingPaymentEvents,
  bookingCheckouts,
  bookingCheckoutBookings,
  paymentOperationIntents,
} as const;

async function moneyRowCounts(db: Awaited<ReturnType<typeof context>>["db"]) {
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries(MONEY_TABLES)) {
    const [row] = await db.select({ rows: count() }).from(table);
    counts[name] = row?.rows ?? 0;
  }
  return counts;
}

async function context() {
  const { db, shop } = await seededShopContext();
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
    /** Inside the arrivals window and past the shop's dock call. */
    now: new Date(trip.startsAt.getTime() - 10 * MINUTE_MS),
  };
}

async function statusOf(db: Awaited<ReturnType<typeof context>>["db"], bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

describe("markBookingNoShow", () => {
  it("records the absence and writes the trail line that says who released the seat", async () => {
    const { db, shop, trip, staffId, bookingId, personName, now } = await context();

    const outcome = await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId,
      recordedByPersonId: staffId,
      now,
    });

    expect(outcome).toEqual({ ok: true, bookingId, tripId: trip.id, personName });
    expect(await statusOf(db, bookingId)).toBe("no_show");
    const trail = await db
      .select({ code: activityEvents.code, params: activityEvents.params })
      .from(activityEvents)
      .where(
        and(eq(activityEvents.bookingId, bookingId), eq(activityEvents.code, "booking_no_show")),
      );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.params).toMatchObject({ diver: personName });
  });

  /**
   * **The money boundary, as an assertion rather than a comment.**
   *
   * A diver who missed a boat may be owed a refund, may owe the fare, or may
   * be a regular the owner waves through, and which of those it is is a
   * decision a person makes on the order. If this writer ever grows a money
   * side effect — an auto-refund, a cancellation fee, a voided checkout — this
   * test is what fails, on the row count of every table that could carry one.
   */
  it("moves no money at all", async () => {
    const { db, shop, staffId, bookingId, now } = await context();
    const before = await moneyRowCounts(db);
    const paymentsBefore = await db
      .select()
      .from(bookingPayments)
      .where(eq(bookingPayments.bookingId, bookingId));

    expect(
      await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toMatchObject({ ok: true });

    expect(await moneyRowCounts(db)).toEqual(before);
    expect(
      await db.select().from(bookingPayments).where(eq(bookingPayments.bookingId, bookingId)),
    ).toEqual(paymentsBefore);
  });

  /**
   * **A diver the crew recorded aboard is on the water.** Marking them absent
   * would take a person the manifest is holding off the counter's expected
   * list while somebody may be counting heads at the rail.
   */
  it("refuses a diver roll call already recorded aboard", async () => {
    const { db, shop, trip, staffId, bookingId, personName, now } = await context();
    // Roll call only takes a diver readiness clears, so the seat's waiver is
    // signed first — the same setup `check-in.test.ts` uses for its own
    // boarded-diver cases.
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error("waiver request refused");
    await completeWaiver(db, issued.token, {
      signerName: personName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
      }),
    ).toMatchObject({ ok: true });

    expect(
      await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: false, reason: "already_boarded" });
    expect(await statusOf(db, bookingId)).not.toBe("no_show");
  });

  it("refuses before the shop's dock call and after the counter stops looking back", async () => {
    const { db, shop, trip, staffId, bookingId } = await context();
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        now: new Date(trip.startsAt.getTime() - 3 * 60 * MINUTE_MS),
      }),
    ).toEqual({ ok: false, reason: "before_dock_call" });
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        now: new Date(trip.startsAt.getTime() + 7 * 60 * MINUTE_MS),
      }),
    ).toEqual({ ok: false, reason: "window_closed" });
    expect(await statusOf(db, bookingId)).not.toBe("no_show");
  });

  it("refuses a second tap on a seat already marked", async () => {
    const { db, shop, staffId, bookingId, now } = await context();
    const input = { shopId: shop.id, bookingId, recordedByPersonId: staffId, now };
    expect(await markBookingNoShow(db, input)).toMatchObject({ ok: true });
    expect(await markBookingNoShow(db, input)).toEqual({ ok: false, reason: "already_marked" });
  });

  it("refuses a seat the diver gave up", async () => {
    const { db, shop, staffId, bookingId, now } = await context();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    expect(
      await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: false, reason: "not_booked" });
  });

  it("refuses a recorder who is not this shop's staff", async () => {
    const { db, shop, bookingId, personName, now } = await context();
    const [diver] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, personName)))
      .limit(1);
    if (!diver) throw new Error("seeded diver missing");
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: diver.id,
        now,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
  });

  /**
   * A booking belonging to another tenant is **not found** — never refused on
   * its merits, which would confirm to one shop that a seat exists at another.
   */
  it("never reaches across shops", async () => {
    const { db, shop, staffId, now } = await context();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-no-show", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const [stranger] = await db
      .insert(people)
      .values({ shopId: other.id, fullName: "Someone Else" })
      .returning();
    const [otherTrip] = await db
      .insert(trips)
      .values({
        shopId: other.id,
        title: "Their Reef Run",
        startsAt: new Date(now.getTime() + 10 * MINUTE_MS),
        endsAt: new Date(now.getTime() + 4 * 60 * MINUTE_MS),
        capacity: 6,
      })
      .returning();
    if (!stranger || !otherTrip) throw new Error("other tenant fixture failed");
    const [theirSeat] = await db
      .insert(bookings)
      .values({ shopId: other.id, tripId: otherTrip.id, personId: stranger.id })
      .returning();
    if (!theirSeat) throw new Error("other tenant booking failed");

    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: theirSeat.id,
        recordedByPersonId: staffId,
        now,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await statusOf(db, theirSeat.id)).toBe("booked");
  });
});

describe("undoBookingNoShow", () => {
  it("puts the diver back on the expected list and keeps both taps on the trail", async () => {
    const { db, shop, trip, staffId, bookingId, personName, now } = await context();
    await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now });

    expect(
      await undoBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: true, bookingId, tripId: trip.id, personName });
    expect(await statusOf(db, bookingId)).toBe("booked");
    const trail = await db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, bookingId),
          inArray(activityEvents.code, ["booking_no_show", "booking_no_show_undone"]),
        ),
      );
    expect(trail.map((row) => row.code).sort()).toEqual([
      "booking_no_show",
      "booking_no_show_undone",
    ]);
  });

  /**
   * **The release was real, so the undo can fail.** By the time somebody taps
   * it the shop may have sold the freed seat to the diver who was waiting for
   * it, and putting the first one back would overfill the boat.
   */
  it("refuses and writes nothing when the freed seat has been resold", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now });

    // The seat went to somebody else: every place on the boat is now held by a
    // booking that is not this one.
    const [held] = await db
      .select({ seats: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), inArray(bookings.status, [...SEAT_HELD_STATUSES])));
    await db
      .update(trips)
      .set({ capacity: held?.seats ?? 0 })
      .where(eq(trips.id, trip.id));

    expect(
      await undoBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: false, reason: "trip_full" });
    expect(await statusOf(db, bookingId)).toBe("no_show");
    const undone = await db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, bookingId),
          eq(activityEvents.code, "booking_no_show_undone"),
        ),
      );
    expect(undone).toHaveLength(0);
  });

  it("refuses a seat nobody marked", async () => {
    const { db, shop, staffId, bookingId, now } = await context();
    expect(
      await undoBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: false, reason: "not_marked" });
  });

  it("moves no money either", async () => {
    const { db, shop, staffId, bookingId, now } = await context();
    await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now });
    const before = await moneyRowCounts(db);

    expect(
      await undoBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toMatchObject({ ok: true });

    expect(await moneyRowCounts(db)).toEqual(before);
  });
});

describe("noShowSalvage", () => {
  it("offers the wait list ahead of anything else, and counts only the uninvited", async () => {
    const { db, shop, trip, now } = await context();
    const waiting = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(2);
    const [uninvited, invited] = waiting;
    if (!uninvited || !invited) throw new Error("seeded people missing");
    await db.insert(tripWaitlistEntries).values([
      { shopId: shop.id, tripId: trip.id, personId: uninvited.id },
      { shopId: shop.id, tripId: trip.id, personId: invited.id, invitedAt: now },
    ]);

    expect(await noShowSalvage(db, { shopId: shop.id, tripId: trip.id, now })).toEqual({
      kind: "waitlist",
      count: 1,
    });
  });

  it("falls back to what else the shop is running that week", async () => {
    const { db, shop, trip, now } = await context();
    const [site] = await db
      .select({ diveSiteId: trips.diveSiteId })
      .from(trips)
      .where(eq(trips.id, trip.id));
    const [alternative] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Second Reef Run",
        startsAt: new Date(trip.startsAt.getTime() + 24 * 60 * MINUTE_MS),
        endsAt: new Date(trip.startsAt.getTime() + 28 * 60 * MINUTE_MS),
        capacity: 8,
        diveSiteId: site?.diveSiteId ?? null,
      })
      .returning();
    if (!alternative) throw new Error("alternative trip insert failed");

    const offer = await noShowSalvage(db, { shopId: shop.id, tripId: trip.id, now });
    expect(offer.kind).toBe("alternative");
    if (offer.kind !== "alternative") throw new Error("unreachable");
    expect(offer.departures.map((row) => row.tripId)).toContain(alternative.id);
  });

  it("says there is nothing rather than inventing an offer", async () => {
    const { db, shop, trip, now } = await context();
    // Nothing else on this shop's board shares the reef trip's site or course.
    await db.update(trips).set({ diveSiteId: null, courseId: null }).where(eq(trips.id, trip.id));
    expect(await noShowSalvage(db, { shopId: shop.id, tripId: trip.id, now })).toEqual({
      kind: "none",
    });
  });
});
