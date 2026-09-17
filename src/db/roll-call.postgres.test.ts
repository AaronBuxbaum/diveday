import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seatIsHeld } from "@/lib/no-show";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import {
  departureRollCallForBooking,
  onTheWaterByRollCall,
  recordCrewRollCall,
  recordRollCall,
} from "./manifests";
import { markBookingNoShow } from "./no-show";
import { getBookingReadiness } from "./readiness";
import { bookings, tripAssignments } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

/**
 * **The desk and the rail, contending for one seat** (security and dive-domain
 * review 20260911).
 *
 * `markBookingNoShow` releases a seat on the staffer's confirm tap: `no_show`
 * leaves `SEAT_HELD_STATUSES`, so a walk-in can buy it. It guards that with the
 * booking row read `FOR UPDATE` and re-runs its gate against what it read, and
 * its docblock says the second run is the one that counts — "between a staffer
 * looking at the row and tapping it, the crew can record that diver aboard".
 *
 * That was true of every clause but the one `noShowGate` calls safety first.
 * `recordRollCall` read the booking with a **plain select**, so the two
 * transactions shared no lock object at all: the desk could decide "nobody has
 * boarded them" and the rail could decide "they are aboard" against the same
 * pre-state, and both commit. The boat then sails with a body aboard whose seat
 * the shop has released — and, if the wait list moved, sold.
 *
 * PGlite is single-connection, so every other test of this pair is structurally
 * incapable of showing it (`@/test/postgres`, and `bookings.postgres.test.ts`'s
 * header for the same gap on the oversell lock). This is the one place two real
 * backends sit inside the critical section at once.
 *
 * ## What the gate proves, and what going red looks like
 *
 * The gate proves **simultaneity**: a third connection takes the booking row's
 * lock, both contenders are started, and nothing is released until Postgres
 * itself reports two backends parked on that lock. It proves nothing about the
 * guard — a contender blocks there whether or not the code under test locks
 * anything, because the roll-call insert's foreign key to `bookings` takes a
 * `KEY SHARE` lock on the same row.
 *
 * **This was measured, not reasoned about.** Deleting the `.for("update")` on
 * `recordRollCall`'s booking read and rerunning this file three times: red
 * three times, and on a **deadlock** rather than on the assertions —
 * `40P01 … while locking tuple in relation "trips"`. Without the lock the rail
 * reaches its insert first and takes the foreign-key locks in the opposite
 * order to the desk's join, so under a gate this tight Postgres catches the
 * pair and shoots one of them. In the wild the window is looser — the rail's
 * readiness read sits between its booking read and its insert, and the desk's
 * whole transaction fits in it — and then nothing catches them: both commit,
 * and the boat sails with a boarded diver whose seat has been released and may
 * already be sold. Restoring the lock: green three times. So a future reader
 * deleting it does not get a quiet pass, and neither shape of the failure is
 * the assertions being wrong.
 *
 * The assertions themselves are the invariant: a standing `boarded` departure
 * result, and a seat nobody is holding, must never both be true.
 */

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);

/** The demo shop's reef departure, with one diver readiness will clear. */
async function readyDiverAtTheDock(db: AppDb) {
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  // Roll call only takes a diver readiness clears, so a seat is picked by
  // asking the engine rather than by trusting the demo roster's order: the
  // subject of this test is the lock, and a fixture that quietly boarded
  // nobody would pass it for the wrong reason.
  for (const seat of await getTripRoster(db, shop.id, reef.id)) {
    if ((await getBookingReadiness(db, shop.id, seat.booking.id))?.status !== "ready") {
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: seat.booking.id });
      if (!issued.ok) continue;
      await completeWaiver(db, issued.token, {
        signerName: seat.person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
      });
    }
    if ((await getBookingReadiness(db, shop.id, seat.booking.id))?.status !== "ready") continue;
    return {
      shopId: shop.id,
      tripId: reef.id,
      startsAt: reef.startsAt,
      bookingId: seat.booking.id,
      staffId: staff.person.id,
    };
  }
  throw new Error("no diver on the demo reef trip could be made ready");
}

async function statusOf(db: AppDb, bookingId: string): Promise<string> {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  if (!row) throw new Error("booking vanished");
  return row.status;
}

describePostgres("the counter's mark and the crew's tap, racing for one booking", () => {
  it("never leaves a boarded diver sitting on a released seat", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, startsAt, bookingId, staffId } = await readyDiverAtTheDock(pg.db);

    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${bookingId} for update`,
    );
    // Two genuinely separate connections, so these are two Postgres backends
    // rather than two awaits interleaved on one.
    const desk = markBookingNoShow(pg.connect(), {
      shopId,
      bookingId,
      recordedByPersonId: staffId,
      now: startsAt,
    });
    const rail = recordRollCall(pg.connect(), {
      shopId,
      tripId,
      bookingId,
      recordedByPersonId: staffId,
      status: "boarded",
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [deskResult, railResult] = await Promise.all([desk, rail]);

    // **The rail never refuses.** Whichever order the two landed in, a crew
    // member recording a body on the boat is the strongest evidence this
    // product holds, and nothing on this path is allowed to turn it away.
    expect(railResult).toMatchObject({ ok: true });
    expect(await departureRollCallForBooking(pg.db, shopId, tripId, bookingId)).toBe("boarded");
    // **And the seat is somebody's.** The half that can silently stop being
    // true: with the two transactions sharing no lock, the desk's mark commits
    // against a pre-boarding read and the booking ends `no_show` with a
    // standing boarded result over it — a body on the water on a seat the shop
    // has put back on sale.
    expect(seatIsHeld(await statusOf(pg.db, bookingId))).toBe(true);
    // Which of them won is not asserted and must not be: both orders are
    // legitimate operations of the product. If the desk got there first its
    // mark stands in the trail and the boarding took the seat back; if the
    // rail did, the mark is refused as `already_boarded`. Only the combination
    // of the two facts above is a boat nobody can account for.
    if (!deskResult.ok) expect(deskResult.reason).toBe("already_boarded");
  });
});

/**
 * The same seat, held by somebody who is also on the crew list: a shop where
 * staff dive too, which the demo roster and `manifests.test.ts` both treat as
 * ordinary. No readiness work, because the crew path has no readiness gate —
 * which is itself why this ordering matters, since a staffer's own seat is
 * exactly the one the dock would refuse a diver-side boarding on.
 */
async function crewMemberWithASeat(db: AppDb) {
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  // `bookings_trip_person_unique` allows one seat per person per departure, so
  // the subject is a staffer the demo roster has not already seated here.
  const seated = new Set((await getTripRoster(db, shop.id, reef.id)).map((s) => s.person.id));
  const crew = (await listStaff(db, shop.id)).find((s) => !seated.has(s.person.id));
  if (!crew) throw new Error("every demo staffer already holds a seat on the reef trip");
  await db
    .insert(tripAssignments)
    .values({ tripId: reef.id, personId: crew.person.id })
    .onConflictDoNothing();
  const [seat] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: reef.id, personId: crew.person.id, status: "booked" })
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
 * **The same race, on the other half of the head count** (dive-domain-expert
 * review, issue #1686).
 *
 * `noShowGate` reads `onTheWaterByRollCall`, which answers from the diver trail
 * *and* the crew trail. The act that undoes a release read only the diver
 * trail, so `recordCrewRollCall` touched no booking row at all — and a path
 * that touches no booking row shares no lock with the desk by construction.
 * The two then decide against the same pre-state every time rather than under a
 * race: the desk sees no boarding and releases, the rail sees a seat that is
 * not `no_show` and takes nothing back, and both commit.
 *
 * Which makes the guard here the *whole* fix rather than a hardening of one:
 * this is not a window that is usually closed, it was a window that was always
 * open. The `.for("update")` on the reclaim's booking read is what makes the
 * crew tap and the desk tap meet, and the gate below proves they meet.
 *
 * **Measured the same way as its sibling above.** Deleting that `.for("update")`
 * and rerunning: red, at `waitForLockWaiters` — "1 of 2 backends blocked" —
 * because the rail's whole transaction fits inside the gate and never parks on
 * anything. So the failure a future reader gets is the contenders never having
 * met, which is exactly what is wrong, rather than a quiet pass.
 */
describePostgres("the counter's mark and the crew's tap, racing for a staffer's own seat", () => {
  it("never leaves a boarded crew member sitting on a released seat", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, startsAt, bookingId, staffId } = await crewMemberWithASeat(pg.db);

    const gate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${bookingId} for update`,
    );
    const desk = markBookingNoShow(pg.connect(), {
      shopId,
      bookingId,
      recordedByPersonId: staffId,
      now: startsAt,
    });
    const rail = recordCrewRollCall(pg.connect(), {
      shopId,
      tripId,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [deskResult, railResult] = await Promise.all([desk, rail]);

    // The rail never refuses, on either trail.
    expect(railResult).toMatchObject({ ok: true });
    expect(await onTheWaterByRollCall(pg.db, shopId, tripId, bookingId)).toBe("boarded");
    // And the seat is somebody's — the half that used to be silently false.
    expect(seatIsHeld(await statusOf(pg.db, bookingId))).toBe(true);
    // Which of them won is not asserted, for the sibling's reason: both orders
    // are legitimate. Desk first and the boarding takes the seat back; rail
    // first and the mark is refused.
    if (!deskResult.ok) expect(deskResult.reason).toBe("already_boarded");
  });
});
