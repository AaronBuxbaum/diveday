import { and, count, desc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { checkInBooking, undoCheckInBooking } from "./check-in";
import { recordRollCall } from "./manifests";
import { markBookingNoShow, noShowSalvage, undoBookingNoShow } from "./no-show";
import {
  activityEvents,
  bookingArrivalEvents,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  courses,
  orderLineItems,
  orders,
  paymentOperationIntents,
  people,
  rollCallEvents,
  shops,
  trips,
  tripWaitlistEntries,
} from "./schema";
import {
  createTrip,
  getTripRoster,
  listStaff,
  setTripCrew,
  setTripStatus,
  upcomingTripsWithCounts,
} from "./trips";
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
    /** Inside the arrivals window, ten minutes after the boat left without them. */
    now: new Date(trip.startsAt.getTime() + 10 * MINUTE_MS),
  };
}

async function statusOf(db: Awaited<ReturnType<typeof context>>["db"], bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

/** The seats a departure is actually holding, which is what every cap counts. */
async function heldSeats(db: Awaited<ReturnType<typeof context>>["db"], tripId: string) {
  const [row] = await db
    .select({ seats: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), inArray(bookings.status, [...SEAT_HELD_STATUSES])));
  return row?.seats ?? 0;
}

/**
 * **The desk really sees the diver**, through `checkInBooking` rather than a
 * hand-written `booking_arrival_events` row, so what the cases below pin is the
 * whole path: the counter leaves the trail this module reads back, and the two
 * cannot drift apart in a fixture. Readiness gates the tap, so the seat's
 * waiver is signed first — the same setup the boarded-diver cases use.
 */
async function checkInAtTheDesk(ctx: Awaited<ReturnType<typeof context>>): Promise<void> {
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
  const outcome = await checkInBooking(ctx.db, {
    shopId: ctx.shop.id,
    bookingId: ctx.bookingId,
    recordedByPersonId: ctx.staffId,
    now: ctx.now,
  });
  if (!outcome.ok) {
    // The blockers, not just "not_ready": a fixture that stops being ready
    // because readiness grew a rule is otherwise a silent afternoon.
    const blockers = "blockers" in outcome ? JSON.stringify(outcome.blockers) : "";
    throw new Error(`check-in refused: ${outcome.reason} ${blockers}`);
  }
}

/** The seat's arrival statements, newest first — the three keys every reader of
 * this trail orders by (`src/db/arrival-provenance.ts`). */
async function arrivalTrail(db: Awaited<ReturnType<typeof context>>["db"], bookingId: string) {
  const rows = await db
    .select({ status: bookingArrivalEvents.status })
    .from(bookingArrivalEvents)
    .where(eq(bookingArrivalEvents.bookingId, bookingId))
    .orderBy(
      desc(bookingArrivalEvents.occurredAt),
      desc(bookingArrivalEvents.createdAt),
      desc(bookingArrivalEvents.seq),
    );
  return rows.map((row) => row.status);
}

/**
 * A solo-instructor Discover Scuba session on a hull with room to spare, so the
 * only limit that can ever refuse a seat here is the 2:1 intro ratio. Far out
 * on the calendar for the reason `src/db/bookings.test.ts` gives its twin: it
 * must not land among the seeded board the other tests read.
 */
const INTRO_SESSION_OFFSET_MS = 180 * 24 * 60 * 60 * 1000;

async function introSession(db: Awaited<ReturnType<typeof context>>["db"], shopId: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, "Discover Scuba Diving")));
  if (!course) throw new Error("Discover Scuba Diving course missing");
  const instructor = (await listStaff(db, shopId)).find((entry) =>
    entry.roles.includes("instructor"),
  );
  if (!instructor) throw new Error("seeded instructor missing");
  const startsAt = new Date(nowMs() + INTRO_SESSION_OFFSET_MS);
  const trip = await createTrip(db, {
    shopId,
    courseId: course.id,
    title: "Discover Scuba — counter undo test",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("failed to create intro test trip");
  if (!(await setTripCrew(db, shopId, trip.id, [instructor.person.id]))) {
    throw new Error("failed to assign instructor");
  }
  return trip;
}

/**
 * **A second shop, with a departure, a diver and a seat of its own.**
 *
 * Every reader in this module takes the caller's `shopId` *and* a
 * caller-supplied id, and the pairing is the whole tenancy boundary (CR-007).
 * A fixture that only ever holds this shop's rows can prove a function returns
 * the right answer and nothing about whose rows it looked at, so the cases
 * below hand each one a row that really belongs to somebody else.
 */
async function otherTenant(db: Awaited<ReturnType<typeof context>>["db"], now: Date, slug: string) {
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
    .values({ shopId: shop.id, tripId: trip.id, personId: stranger.id })
    .returning();
  if (!seat) throw new Error("other tenant booking failed");
  return { shop, stranger, trip, seat };
}

/** Books `seats` students onto a session, asserting every one is accepted. */
async function seatStudents(
  db: Awaited<ReturnType<typeof context>>["db"],
  shopId: string,
  tripId: string,
  seats: number,
) {
  const ids: string[] = [];
  for (let i = 0; i < seats; i++) {
    const suffix = `${tripId.slice(0, 8)}-${ids.length}-${seats}`;
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId,
      tripId,
      fullName: `DSD Student ${suffix}`,
      email: `dsd-student-${suffix}@example.com`,
    });
    if (!outcome.ok) throw new Error(`intro seat refused: ${outcome.reason}`);
    ids.push(outcome.bookingId);
  }
  return ids;
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
   * **The mark does not take the sighting back** (issue #1558). A staffer stood
   * in front of this diver at 06:40 and tapped them in; that they then missed
   * the boat is a different statement, and writing a `cleared` row here would
   * erase the first one. Two readers spend the standing `arrived` row precisely
   * to contradict this status — `findSimilarDivers` prints "Last dive day here"
   * at the counter's identity question, and `peopleWhoDivedBefore` feeds the
   * fly-safe multi-day advisory — so a retraction written here costs a diver a
   * day off their surface interval for a morning the shop really did see them.
   */
  it("leaves the sighting the desk already made standing on the trail", async () => {
    const ctx = await context();
    await checkInAtTheDesk(ctx);
    expect(await arrivalTrail(ctx.db, ctx.bookingId)).toEqual(["arrived"]);

    expect(
      await markBookingNoShow(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true });

    expect(await statusOf(ctx.db, ctx.bookingId)).toBe("no_show");
    expect(await arrivalTrail(ctx.db, ctx.bookingId)).toEqual(["arrived"]);
  });

  /**
   * **The mark is not a roll call, and the after-dive head count rests on
   * that** (`inAfterDivePopulation`, src/db/today.ts). That reader decides who
   * is at risk in the water from `roll_call_events` alone, because a walk-away
   * leaves no result at any checkpoint whether or not the desk released their
   * seat. Releasing it writes `bookings.status` and a trail line; the day it
   * also wrote a checkpoint result, every released seat would join the
   * population the danger-toned "still in the water" row counts, and a red row
   * that fires on most trips is read by nobody within a fortnight.
   */
  it("writes nothing into the crew's roll call", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();

    expect(
      await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toMatchObject({ ok: true });

    expect(
      await db
        .select({ rows: count() })
        .from(rollCallEvents)
        .where(and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.tripId, trip.id))),
    ).toEqual([{ rows: 0 }]);
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

  /**
   * **The dock is not the only place the crew says a diver is aboard.** A diver
   * who joined at the second site, or one the crew counted without a dock
   * result, has no departure event at all — the population `src/db/today.ts`
   * names at `inAfterDivePopulation`. Reading the departure checkpoint alone
   * left the counter's first and most important refusal silent about exactly
   * those divers, and the counter's window runs six hours past `startsAt`,
   * which covers a whole two-tank morning.
   *
   * No waiver here on purpose: readiness gates boarding at the dock only, so an
   * after-dive head count takes the diver as they are (`recordRollCall`).
   */
  it("refuses a diver the crew counted at an after-dive checkpoint", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
        checkpoint: "after_dive_1",
      }),
    ).toMatchObject({ ok: true });

    expect(
      await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: false, reason: "already_boarded" });
    expect(await statusOf(db, bookingId)).not.toBe("no_show");
  });

  /**
   * **The crew recorded this diver missing after a dive, and the desk may not
   * call that an absence** (issue #1704).
   *
   * `not_boarded` at an after-dive checkpoint is not "never came": it is "did
   * not come back from the dive", and it is the one row on the manifest that
   * means somebody may still be in the water (`isAccountedForAfterDive` and
   * `inAfterDivePopulation`, src/db/today.ts; **sailed** in the glossary, which
   * says that diver sailed and is the one the day is still looking for).
   * Releasing their seat here would put it back on sale — and a wait-list diver
   * into it — while the crew are still counting heads at the rail.
   *
   * Reached without any departure event at all, which is the adversarial half:
   * `recordRollCall` accepts an after-dive result with no prior dock result, so
   * the refusal cannot lean on a departure row being there to find.
   */
  it("refuses a diver the crew recorded missing after a dive", async () => {
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
      await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: false, reason: "already_boarded" });
    expect(await statusOf(db, bookingId)).not.toBe("no_show");
  });

  /**
   * **The other direction, and the reason this is not one rule about
   * `not_boarded`.** At the dock the same word means "never left the dock",
   * which is the benign half and the ordinary absence the counter exists to
   * record: the crew have already said this diver did not come, and the desk
   * saying so too must still release the seat.
   *
   * The second case is the one that fails if the refusal is built on
   * `carryForwardNotBoarded` (src/lib/roll-call.ts) rather than on persisted
   * rows. That helper carries the dock's `not_boarded` onto every later
   * checkpoint, so a reader composed on it sees a standing after-dive result
   * here — on a seat the crew touched exactly once, at the dock — and makes
   * every walk-away on every trip permanently un-markable.
   */
  it("still releases the seat of a diver the crew recorded ashore at the dock", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "not_boarded",
      }),
    ).toMatchObject({ ok: true });

    // No after-dive row of any kind — only the dock's, carried forward by a
    // helper this path deliberately does not ask.
    expect(
      await db
        .select({ rows: count() })
        .from(rollCallEvents)
        .where(
          and(eq(rollCallEvents.bookingId, bookingId), eq(rollCallEvents.checkpoint, "departure")),
        ),
    ).toEqual([{ rows: 1 }]);

    expect(
      await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toMatchObject({ ok: true });
    expect(await statusOf(db, bookingId)).toBe("no_show");
  });

  /**
   * The opening moved off the shop's dock call on 2026-09-11: a diver who is
   * late for the arrival time the shop asked for has not missed the boat, and
   * this tap writes the second fact rather than the first.
   */
  it("refuses before the boat leaves and after the counter stops looking back", async () => {
    const { db, shop, trip, staffId, bookingId } = await context();
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        // Past the shop's own dock call, which used to open this door, and
        // still ten minutes before the lines come off.
        now: new Date(trip.startsAt.getTime() - 10 * MINUTE_MS),
      }),
    ).toEqual({ ok: false, reason: "before_departure" });
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
    const { seat: theirSeat } = await otherTenant(db, now, "other-reef-no-show");

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
   * **The seat comes back as what it was.** The undo is for the diver who walks
   * up as the lines come off, and half of them are people the desk had already
   * checked in before releasing the seat. Restoring every one of them to
   * `booked` put a diver standing at the counter back on the "still to come"
   * list and asked the staffer to check them in a second time with the diver in
   * front of them (`dive-domain-expert`, 2026-09-11). The arrival trail is the
   * only record of which it was, because the mark deliberately leaves it alone.
   */
  it("puts a diver the desk had already seen back as checked in", async () => {
    const ctx = await context();
    await checkInAtTheDesk(ctx);
    const seatsBefore = await heldSeats(ctx.db, ctx.trip.id);
    await markBookingNoShow(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingId,
      recordedByPersonId: ctx.staffId,
      now: ctx.now,
    });

    expect(
      await undoBookingNoShow(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true });
    expect(await statusOf(ctx.db, ctx.bookingId)).toBe("checked_in");
    // `checked_in` holds a seat exactly as `booked` does, so the boat is back
    // to the count it had before the release — the caps this undo checks are
    // counting the same thing either way.
    expect(await heldSeats(ctx.db, ctx.trip.id)).toBe(seatsBefore);
  });

  /**
   * The other half of the same rule, and the reason it is the trail that
   * decides rather than "was there ever an arrival": a sighting the desk took
   * back before the mark leaves a `cleared` row standing, nothing says this
   * diver is in the building, and the seat comes back as `booked`.
   */
  it("puts a seat whose sighting was taken back before the mark back as booked", async () => {
    const ctx = await context();
    await checkInAtTheDesk(ctx);
    expect(
      await undoCheckInBooking(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true });
    await markBookingNoShow(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.bookingId,
      recordedByPersonId: ctx.staffId,
      now: ctx.now,
    });

    expect(
      await undoBookingNoShow(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.bookingId,
        recordedByPersonId: ctx.staffId,
        now: ctx.now,
      }),
    ).toMatchObject({ ok: true });
    expect(await arrivalTrail(ctx.db, ctx.bookingId)).toEqual(["cleared", "arrived"]);
    expect(await statusOf(ctx.db, ctx.bookingId)).toBe("booked");
  });

  /**
   * **The release was real, so the undo can fail.** By the time somebody taps
   * it the shop may have sold the freed seat to the diver who was waiting for
   * it, and putting the first one back would overfill the boat.
   *
   * And the failure is itself history: a staffer stood at a desk with a diver
   * in front of them who could not get back on, and the shop reconciling that
   * departure afterwards can only see it if the refusal left a line. The seat
   * does **not** move, so the roster write is still the thing that must not
   * happen.
   */
  it("refuses a resold seat and puts the attempt on the trail", async () => {
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
    // Which limit refused, because the two ask for different next acts: a sold
    // seat means find the diver another boat.
    const refused = await db
      .select({ params: activityEvents.params })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, bookingId),
          eq(activityEvents.code, "booking_no_show_undo_refused"),
        ),
      );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.params).toMatchObject({ reason: "trip_full" });
  });

  /**
   * **The boat is not the tightest limit a seat can hit.** An intro session
   * seats two students per instructor whatever the boat holds (DOM-H2,
   * `src/lib/course-ratios.ts`), and an undo is a seat-granting write like
   * every other one: capacity alone reads room on a twelve-seat hull while the
   * instructor has none, and the morning it costs somebody looks like this —
   * a late participant marked not here as the boat pulls out, a walk-up seated
   * into the freed place, then Undo as the lines come off.
   */
  it("refuses an undo that would put a third student on a two-seat intro session", async () => {
    const { db, shop, staffId } = await context();
    const trip = await introSession(db, shop.id);
    const now = new Date(trip.startsAt.getTime() + 10 * MINUTE_MS);
    const [late, onTime] = await seatStudents(db, shop.id, trip.id, 2);
    if (!late || !onTime) throw new Error("setup bookings failed");

    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId: late,
        recordedByPersonId: staffId,
        now,
      }),
    ).toMatchObject({ ok: true });
    // The walk-up is legitimate: the session is back at its two students, and
    // the boat still shows ten empty seats.
    await seatStudents(db, shop.id, trip.id, 1);

    expect(
      await undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId: late,
        recordedByPersonId: staffId,
        now,
      }),
    ).toEqual({ ok: false, reason: "course_ratio_full" });
    expect(await statusOf(db, late)).toBe("no_show");
    // The ratio refusal reads as itself on the trail, not as the sold-seat one:
    // this session needs another instructor, not another boat.
    const refused = await db
      .select({ params: activityEvents.params })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, late),
          eq(activityEvents.code, "booking_no_show_undo_refused"),
        ),
      );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.params).toMatchObject({ reason: "course_ratio_full" });
    // Two students in the water, which is what one instructor may take. The
    // roster itself still lists three rows — the marked one among them, wearing
    // "Not here" — so the seats are counted, not the lines.
    expect(await heldSeats(db, trip.id)).toBe(2);
  });

  it("still undoes onto an intro session while the ratio genuinely has room", async () => {
    const { db, shop, staffId } = await context();
    const trip = await introSession(db, shop.id);
    const now = new Date(trip.startsAt.getTime() + 10 * MINUTE_MS);
    const [late] = await seatStudents(db, shop.id, trip.id, 2);
    if (!late) throw new Error("setup bookings failed");
    await markBookingNoShow(db, {
      shopId: shop.id,
      bookingId: late,
      recordedByPersonId: staffId,
      now,
    });

    expect(
      await undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId: late,
        recordedByPersonId: staffId,
        now,
      }),
    ).toMatchObject({ ok: true });
    expect(await statusOf(db, late)).toBe("booked");
  });

  /**
   * Nobody fails to show for a boat that never left, and nobody goes back on
   * one either: the mark is already refused on a cancelled departure
   * (`noShowGate`), and the undo answers the way `restoreBooking` does —
   * reinstating the trip is the recovery, not a roster write against a day
   * that is off the board.
   */
  it("refuses an undo onto a departure the shop cancelled in between", async () => {
    const { db, shop, trip, staffId, bookingId, now } = await context();
    await markBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now });
    expect(await setTripStatus(db, shop.id, trip.id, "cancelled")).toBeTruthy();

    expect(
      await undoBookingNoShow(db, { shopId: shop.id, bookingId, recordedByPersonId: staffId, now }),
    ).toEqual({ ok: false, reason: "trip_cancelled" });
    expect(await statusOf(db, bookingId)).toBe("no_show");
    // Neither the undo nor a refusal line: the two refusals that get their own
    // entry are the ones where the *seat* is gone and a shop has a next act to
    // take. A cancelled departure is already on the board, and reinstating it
    // is the recovery.
    const written = await db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.bookingId, bookingId),
          inArray(activityEvents.code, ["booking_no_show_undone", "booking_no_show_undo_refused"]),
        ),
      );
    expect(written).toHaveLength(0);
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

  /**
   * The undo is the half that hands a seat back, so a leak here is worse than
   * the mark's: it would put a stranger's diver onto a departure this shop
   * cannot see, under a cap this shop did not set. Not found, like the mark,
   * and for the same reason — a refusal on the merits (`not_marked`,
   * `trip_full`) would confirm to one shop that a seat exists at another.
   */
  it("never reaches across shops either", async () => {
    const { db, shop, staffId, now } = await context();
    const { seat: theirSeat } = await otherTenant(db, now, "other-reef-no-show-undo");
    // Marked at their own counter, so a leak would be a *successful* undo
    // rather than the `not_marked` a plain booking would answer with.
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, theirSeat.id));

    expect(
      await undoBookingNoShow(db, {
        shopId: shop.id,
        bookingId: theirSeat.id,
        recordedByPersonId: staffId,
        now,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await statusOf(db, theirSeat.id)).toBe("no_show");
    expect(
      await db
        .select({ code: activityEvents.code })
        .from(activityEvents)
        .where(eq(activityEvents.bookingId, theirSeat.id)),
    ).toHaveLength(0);
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

  it("falls back to a day the diver who missed could be put on instead", async () => {
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
    expect(offer.kind).toBe("rebook");
    if (offer.kind !== "rebook") throw new Error("unreachable");
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

  /**
   * **The `tripId` is caller-supplied and fans out**, which is what makes this
   * the reader worth pinning: it is spent on a wait-list read and then on the
   * board, so a scope dropped anywhere along that path hands one shop the
   * names another shop is holding. Nothing, not a count — a salvage offer that
   * said "1 waiting" about somebody else's list would send a staffer after a
   * diver they have no relationship with.
   */
  it("never counts another shop's wait list", async () => {
    const { db, shop, now } = await context();
    const {
      shop: other,
      stranger,
      trip: theirTrip,
    } = await otherTenant(db, now, "other-reef-salvage");
    await db
      .insert(tripWaitlistEntries)
      .values({ shopId: other.id, tripId: theirTrip.id, personId: stranger.id });

    expect(await noShowSalvage(db, { shopId: shop.id, tripId: theirTrip.id, now })).toEqual({
      kind: "none",
    });
  });
});
