import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seatIsHeld } from "@/lib/no-show";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { cancelBooking, createBooking, setBookingParticipantType } from "./bookings";
import { checkInBooking } from "./check-in";
import type { AppDb } from "./client";
import { departureRollCallForBooking, recordCrewRollCall, recordRollCall } from "./manifests";
import { markBookingNoShow, undoBookingNoShow } from "./no-show";
import { getBookingReadiness } from "./readiness";
import { bookings, tripAssignments } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { createTrip, getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

/**
 * **One lock order for a seat: the trip, then the booking** (#2324; the order
 * is written down beside `createBookingRecord` in `./bookings.ts`).
 *
 * Two writers that take the same two rows in opposite orders deadlock when
 * they meet: Postgres kills one, and a staffer's tap fails. `undoBookingNoShow`
 * took the booking then the trip, `setBookingParticipantType` the trip then the
 * booking, and `checkInBooking` both at once in one joined `FOR UPDATE`. Each
 * race below parks two of them on one gate and releases them together.
 *
 * PGlite is single-connection, so only a real server can show this
 * (`@/test/postgres`). What the gate proves is simultaneity, never the guard:
 * the assertion that matters is that **both calls return** — a deadlock
 * surfaces as a thrown `40P01` — and that the seat ends somebody's.
 *
 * Measured, not reasoned about: with the old orders back, the first two races
 * fail on `deadlock detected`; the third fails the same way if a seat path
 * takes the trip `FOR UPDATE` instead of `FOR NO KEY UPDATE`, because the
 * crew's roll-call insert needs a `KEY SHARE` on that trip row.
 */

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

/**
 * A fresh departure two days out, and one seat on it that readiness clears:
 * a demo diver whose card is already on file, booked and signed here, so no
 * roll call has ever named them on this boat.
 */
async function readySeat(db: AppDb) {
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  const startsAt = new Date(nowMs() + 2 * 24 * 3_600_000);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Lock order",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
    capacity: 6,
  });
  if (!trip) throw new Error("trip not created");
  for (const seat of await getTripRoster(db, shop.id, reef.id)) {
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      personId: seat.person.id,
      fullName: seat.person.fullName,
      email: seat.person.email ?? `lock-order-${seat.person.id}@example.com`,
    });
    if (!booked.ok) continue;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booked.bookingId });
    if (issued.ok) {
      await completeWaiver(db, issued.token, {
        signerName: seat.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
      });
    }
    if ((await getBookingReadiness(db, shop.id, booked.bookingId))?.status !== "ready") {
      await cancelBooking(db, shop.id, booked.bookingId);
      continue;
    }
    return {
      shopId: shop.id,
      tripId: trip.id,
      startsAt,
      bookingId: booked.bookingId,
      staffId: staff.person.id,
    };
  }
  throw new Error("no demo diver could be made ready on a fresh departure");
}

/**
 * A staffer on the reef trip's crew list who also holds a seat on it — the
 * one subject the crew writer locks a booking for. No readiness work: the
 * crew path has no readiness gate.
 */
async function crewMemberWithASeat(db: AppDb) {
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const seated = new Set((await getTripRoster(db, shop.id, reef.id)).map((s) => s.person.id));
  const crew = (await listStaff(db, shop.id)).find((s) => !seated.has(s.person.id));
  if (!crew) throw new Error("every demo staffer already holds a seat on the reef trip");
  await db
    .insert(tripAssignments)
    .values({ tripId: reef.id, personId: crew.person.id })
    .onConflictDoNothing();
  const [seat] = await db
    .insert(bookings)
    .values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: reef.id,
      personId: crew.person.id,
      status: "booked",
    })
    .returning({ id: bookings.id });
  if (!seat) throw new Error("expected the crew member's own seat");
  return {
    shopId: shop.id,
    tripId: reef.id,
    startsAt: reef.startsAt,
    bookingId: seat.id,
    staffId: crew.person.id,
  };
}

/**
 * Why a contender threw, or null when it returned. A deadlock arrives as a
 * query error whose cause carries Postgres' own code (`40P01`), so the message
 * a red run prints names the deadlock rather than "rejected".
 */
function failure(settled: PromiseSettledResult<unknown>): string | null {
  if (settled.status === "fulfilled") return null;
  const error = settled.reason as { message?: string; cause?: { code?: string; message?: string } };
  return `${error.cause?.code ?? ""} ${error.cause?.message ?? error.message ?? String(error)}`.trim();
}

async function statusOf(db: AppDb, bookingId: string): Promise<string> {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking vanished");
  return row.status;
}

describePostgres("seat writers on one departure take the trip, then the booking", () => {
  it("an undo of a no-show and a change of what the diver is doing never deadlock", async () => {
    const pg = await postgresTestDb();
    const seat = await readySeat(pg.db);
    expect(
      await markBookingNoShow(pg.db, {
        shopId: seat.shopId,
        bookingId: seat.bookingId,
        recordedByPersonId: seat.staffId,
        now: seat.startsAt,
      }),
    ).toMatchObject({ ok: true });

    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${seat.tripId} for update`,
    );
    // The change queues on the trip first, so it is first through when the
    // gate opens; the undo queues behind it. Started the other way round the
    // old order could slip through on luck.
    const change = setBookingParticipantType(pg.connect(), {
      shopId: seat.shopId,
      tripId: seat.tripId,
      bookingId: seat.bookingId,
      to: "snorkeler",
      actorPersonId: seat.staffId,
    });
    await waitForLockWaiters(pg.db, 1);
    const undo = undoBookingNoShow(pg.connect(), {
      shopId: seat.shopId,
      bookingId: seat.bookingId,
      recordedByPersonId: seat.staffId,
      now: seat.startsAt,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const [undone, changed] = await Promise.allSettled([undo, change]);
    expect(failure(undone)).toBeNull();
    expect(failure(changed)).toBeNull();
    expect(undone).toMatchObject({ value: { ok: true } });
    expect(seatIsHeld(await statusOf(pg.db, seat.bookingId))).toBe(true);
  });

  it("a counter check-in and a change of what the diver is doing never deadlock", async () => {
    const pg = await postgresTestDb();
    const seat = await readySeat(pg.db);

    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${seat.tripId} for update`,
    );
    const change = setBookingParticipantType(pg.connect(), {
      shopId: seat.shopId,
      tripId: seat.tripId,
      bookingId: seat.bookingId,
      to: "snorkeler",
      actorPersonId: seat.staffId,
    });
    await waitForLockWaiters(pg.db, 1);
    const arrive = checkInBooking(pg.connect(), {
      shopId: seat.shopId,
      bookingId: seat.bookingId,
      recordedByPersonId: seat.staffId,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const [arrived, changed] = await Promise.allSettled([arrive, change]);
    expect(failure(arrived)).toBeNull();
    expect(failure(changed)).toBeNull();
    expect(seatIsHeld(await statusOf(pg.db, seat.bookingId))).toBe(true);
  });

  it("an undo of a no-show never deadlocks against the crew boarding the same diver", async () => {
    const pg = await postgresTestDb();
    const seat = await readySeat(pg.db);
    expect(
      await markBookingNoShow(pg.db, {
        shopId: seat.shopId,
        bookingId: seat.bookingId,
        recordedByPersonId: seat.staffId,
        now: seat.startsAt,
      }),
    ).toMatchObject({ ok: true });

    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${seat.bookingId} for update`,
    );
    // The rail queues on the seat first, so it holds the seat when the gate
    // opens and then needs its trip row for the roll-call insert; the undo is
    // by then holding that trip and waiting on the seat.
    const rail = recordRollCall(pg.connect(), {
      shopId: seat.shopId,
      tripId: seat.tripId,
      bookingId: seat.bookingId,
      recordedByPersonId: seat.staffId,
      status: "boarded",
    });
    await waitForLockWaiters(pg.db, 1);
    const undo = undoBookingNoShow(pg.connect(), {
      shopId: seat.shopId,
      bookingId: seat.bookingId,
      recordedByPersonId: seat.staffId,
      now: seat.startsAt,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const [undone, boarded] = await Promise.allSettled([undo, rail]);
    expect(failure(undone)).toBeNull();
    expect(failure(boarded)).toBeNull();
    // The rail never refuses a body on the boat.
    expect(boarded).toMatchObject({ value: { ok: true } });
    expect(await departureRollCallForBooking(pg.db, seat.shopId, seat.tripId, seat.bookingId)).toBe(
      "boarded",
    );
    expect(seatIsHeld(await statusOf(pg.db, seat.bookingId))).toBe(true);
  });

  /**
   * **The crew writer is a seat writer too** (dive-domain review of #2324).
   * A crew member who holds a seat and is recorded not back aboard after a
   * dive has their booking locked (the reclaim read) and then the trip
   * updated (`pauseRecapOnMissingAfterDive`). Taken in that order it is the
   * reverse of the counter's, and the two deadlock on the staffer's seat.
   */
  it("a crew member not back after a dive and the counter on the same seat never deadlock", async () => {
    const pg = await postgresTestDb();
    const crew = await crewMemberWithASeat(pg.db);

    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${crew.bookingId} for update`,
    );
    const rail = recordCrewRollCall(pg.connect(), {
      shopId: crew.shopId,
      tripId: crew.tripId,
      personId: crew.staffId,
      recordedByPersonId: crew.staffId,
      status: "not_boarded",
      checkpoint: "after_dive_1",
    });
    await waitForLockWaiters(pg.db, 1);
    const desk = markBookingNoShow(pg.connect(), {
      shopId: crew.shopId,
      bookingId: crew.bookingId,
      recordedByPersonId: crew.staffId,
      now: crew.startsAt,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const [railed, desked] = await Promise.allSettled([rail, desk]);
    expect(failure(railed)).toBeNull();
    expect(failure(desked)).toBeNull();
    // The rail never refuses a statement about somebody in the water.
    expect(railed).toMatchObject({ value: { ok: true } });
  });

  /**
   * H-20261015-aboard-diver-removal-at: a removal at the desk and the rail's Aboard tap on the same seat.
   * Both take the trip, then the booking, so the removal reads the tap that
   * landed first and refuses: the diver is marked aboard a boat that has left.
   */
  it("a removal at the desk waits for the rail's Aboard tap and then refuses it", async () => {
    const pg = await postgresTestDb();
    const seat = await readySeat(pg.db);
    const atSea = new Date(seat.startsAt.getTime() + 2 * 60 * 60 * 1000);

    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${seat.tripId} for update`,
    );
    const board = recordRollCall(pg.connect(), {
      shopId: seat.shopId,
      tripId: seat.tripId,
      bookingId: seat.bookingId,
      recordedByPersonId: seat.staffId,
      status: "boarded",
      occurredAt: seat.startsAt,
    });
    await waitForLockWaiters(pg.db, 1);
    const remove = cancelBooking(pg.connect(), seat.shopId, seat.bookingId, { now: atSea });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const [boarded, removed] = await Promise.allSettled([board, remove]);
    expect(failure(boarded)).toBeNull();
    expect(failure(removed)).toBeNull();
    expect(boarded).toMatchObject({ value: { ok: true } });
    expect(removed).toMatchObject({ value: { ok: false, reason: "aboard_at_sea" } });
    expect(await statusOf(pg.db, seat.bookingId)).toBe("booked");
  });
});
