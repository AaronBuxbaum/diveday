import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seatIsHeld } from "@/lib/no-show";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { isLockWaitRefusal } from "./lock-bounds";
import {
  departureRollCallForBooking,
  onTheWaterByRollCall,
  recordCrewRollCall,
  recordRollCall,
} from "./manifests";
import { markBookingNoShow } from "./no-show";
import { CLIENT_EVENT_CONFLICT } from "./offline-replay";
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

/**
 * **A resent offline sync, overlapping the request it gave up on** (layer 1
 * review, 2026-10-23: captain S1, auditor S1).
 *
 * The device abandons a sync at `SYNC_TIMEOUT_MS` and resends the same
 * `clientEventId`s; the abandoned request is still running here. The writers
 * used to ask "is this id recorded?" only before taking the seat lock, while
 * the first request was still uncommitted. The replay then waited on the lock,
 * and once it had it the first request's row was the newest one standing: a
 * replayed `cleared` was refused as `retraction_superseded` (a false
 * missing-diver alarm the device keeps for good), and a replayed mark failed
 * on the unique index with a 500.
 *
 * **The gate.** A third connection holds the recorder's `people` row
 * `FOR UPDATE`. The first request inserts its event and then parks on that
 * row in the insert's own foreign-key check, so its row is written but not
 * committed, and it holds the trip lock. The replay is started only after
 * that, and released only once Postgres reports it parked too.
 */
const MINUTE_MS = 60_000;

async function firstSeatOnTheReef(db: AppDb) {
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [seat] = await getTripRoster(db, shop.id, reef.id);
  if (!seat) throw new Error("demo reef trip has nobody on it");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return {
    shopId: shop.id,
    tripId: reef.id,
    bookingId: seat.booking.id,
    staffId: staff.person.id,
    otherTripIds: trips.filter((trip) => trip.id !== reef.id).map((trip) => trip.id),
  };
}

/** An offline event's own fields, made a minute apart from a saved copy. */
function offlineEvent(minutesAfterSave: number) {
  const savedAt = new Date(nowMs() - 10 * MINUTE_MS);
  return {
    source: "offline" as const,
    clientEventId: crypto.randomUUID(),
    offlineSnapshotSavedAt: savedAt,
    occurredAt: new Date(savedAt.getTime() + minutesAfterSave * MINUTE_MS),
  };
}

async function rowsCarrying(db: AppDb, clientEventId: string): Promise<number> {
  const result = await db.execute(
    sql`select (select count(*) from roll_call_events where client_event_id = ${clientEventId})
             + (select count(*) from roll_call_crew_events where client_event_id = ${clientEventId})
             as n`,
  );
  const rows = Array.isArray(result)
    ? result
    : (result as unknown as { rows: Array<{ n: unknown }> }).rows;
  return Number(rows[0]?.n);
}

/** Runs `write` twice over: the first parked after its insert, the replay behind it. */
async function overlapAReplay<T>(
  pg: Awaited<ReturnType<typeof postgresTestDb>>,
  recorderId: string,
  write: (db: AppDb) => Promise<T>,
): Promise<[T, T]> {
  const gate = await holdRowLock(
    pg,
    sql`select id from people where id = ${recorderId} for update`,
  );
  const first = write(pg.connect());
  await waitForLockWaiters(pg.db, 1);
  const replay = write(pg.connect());
  await waitForLockWaiters(pg.db, 2);
  await gate.release();
  return Promise.all([first, replay]);
}

describePostgres("a resent offline sync overlapping the request it gave up on", () => {
  it("answers a replayed retraction as a duplicate, never as superseded", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, bookingId, staffId } = await firstSeatOnTheReef(pg.db);
    const common = { shopId, tripId, bookingId, recordedByPersonId: staffId };
    const missing = offlineEvent(1);
    await expect(
      recordRollCall(pg.db, {
        ...common,
        ...missing,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });
    const found = {
      ...common,
      ...offlineEvent(2),
      status: "cleared" as const,
      checkpoint: "after_dive_1" as const,
      retractsClientEventId: missing.clientEventId,
    };

    const [first, replay] = await overlapAReplay(pg, staffId, (db) => recordRollCall(db, found));

    expect(first).toMatchObject({ ok: true });
    expect(first.ok && first.duplicate).toBeFalsy();
    expect(replay).toEqual({ ok: true, eventId: first.ok ? first.eventId : "", duplicate: true });
    expect(await rowsCarrying(pg.db, found.clientEventId)).toBe(1);
  });

  it("answers a replayed mark as a duplicate rather than failing the batch", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, bookingId, staffId } = await firstSeatOnTheReef(pg.db);
    const mark = {
      shopId,
      tripId,
      bookingId,
      recordedByPersonId: staffId,
      ...offlineEvent(1),
      status: "not_boarded" as const,
      checkpoint: "after_dive_1" as const,
    };

    const [first, replay] = await overlapAReplay(pg, staffId, (db) => recordRollCall(db, mark));

    expect(first).toMatchObject({ ok: true });
    expect(replay).toEqual({ ok: true, eventId: first.ok ? first.eventId : "", duplicate: true });
    expect(await rowsCarrying(pg.db, mark.clientEventId)).toBe(1);
  });

  it("answers a replayed crew retraction as a duplicate too", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, staffId } = await crewMemberWithASeat(pg.db);
    const common = { shopId, tripId, personId: staffId, recordedByPersonId: staffId };
    const missing = offlineEvent(1);
    await expect(
      recordCrewRollCall(pg.db, {
        ...common,
        ...missing,
        status: "not_boarded",
        checkpoint: "after_dive_1",
      }),
    ).resolves.toMatchObject({ ok: true });
    const found = {
      ...common,
      ...offlineEvent(2),
      status: "cleared" as const,
      checkpoint: "after_dive_1" as const,
      retractsClientEventId: missing.clientEventId,
    };

    const [first, replay] = await overlapAReplay(pg, staffId, (db) =>
      recordCrewRollCall(db, found),
    );

    expect(first).toMatchObject({ ok: true });
    expect(replay).toEqual({ ok: true, eventId: first.ok ? first.eventId : "", duplicate: true });
    expect(await rowsCarrying(pg.db, found.clientEventId)).toBe(1);
  });

  /**
   * The last line: a collision on `roll_call_events_shop_client_event_unique`
   * that no lock lined up. Two seats on two departures share no lock, so the
   * second request reaches its insert while the first is uncommitted, waits
   * on the index, and gets 23505 once the first commits. One id on two
   * subjects is a device bug. Never a 500 that fails the batch, and never a
   * `duplicate` either: that would mark a tap applied that wrote nothing about
   * its own seat, which on a missing-diver mark is the quiet direction
   * (re-review N9). It is refused as a conflict, out loud.
   */
  it("refuses a collision on the client-event index from another seat as a conflict", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, bookingId, staffId, otherTripIds } = await firstSeatOnTheReef(pg.db);
    let elsewhere: { tripId: string; bookingId: string } | undefined;
    for (const otherTripId of otherTripIds) {
      const [seat] = await getTripRoster(pg.db, shopId, otherTripId);
      if (seat) {
        elsewhere = { tripId: otherTripId, bookingId: seat.booking.id };
        break;
      }
    }
    if (!elsewhere) throw new Error("no second demo departure with a diver on it");
    const shared = offlineEvent(1);
    const mark = (seat: { tripId: string; bookingId: string }) => ({
      shopId,
      ...seat,
      recordedByPersonId: staffId,
      ...shared,
      status: "not_boarded" as const,
      checkpoint: "after_dive_1" as const,
    });
    const gate = await holdRowLock(pg, sql`select id from people where id = ${staffId} for update`);
    const first = recordRollCall(pg.connect(), mark({ tripId, bookingId }));
    await waitForLockWaiters(pg.db, 1);
    const second = recordRollCall(pg.connect(), mark(elsewhere));
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({ ok: true });
    expect(secondResult).toEqual({ ok: false, reason: CLIENT_EVENT_CONFLICT });
    expect(await rowsCarrying(pg.db, shared.clientEventId)).toBe(1);
  });

  it("refuses an id already recorded for another seat, before any lock", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, staffId } = await firstSeatOnTheReef(pg.db);
    const [first, second] = await getTripRoster(pg.db, shopId, tripId);
    if (!first || !second) throw new Error("demo reef trip needs two divers");
    const shared = offlineEvent(1);
    const mark = (bookingId: string) => ({
      shopId,
      tripId,
      bookingId,
      recordedByPersonId: staffId,
      ...shared,
      status: "not_boarded" as const,
      checkpoint: "after_dive_1" as const,
    });

    const written = await recordRollCall(pg.db, mark(first.booking.id));
    const replayedOnAnotherSeat = await recordRollCall(pg.db, mark(second.booking.id));
    const replayedOnItsOwnSeat = await recordRollCall(pg.db, mark(first.booking.id));

    expect(written).toMatchObject({ ok: true });
    expect(replayedOnAnotherSeat).toEqual({ ok: false, reason: CLIENT_EVENT_CONFLICT });
    expect(replayedOnItsOwnSeat).toEqual({
      ok: true,
      eventId: written.ok ? written.eventId : "",
      duplicate: true,
    });
    expect(await rowsCarrying(pg.db, shared.clientEventId)).toBe(1);
  });
});

/**
 * **A crew tap behind a stuck trip lock gives up in five seconds** (issue
 * #2983).
 *
 * The crew half of the head count takes the trip row `FOR NO KEY UPDATE`
 * before anything else it locks. The diver half reaches the same row through
 * `lockSeatDeparture`, which bounds its wait (`boundLockWaits`); the crew half
 * did not, so a captain's tap queued behind a held trip waited until its own
 * function was killed, and the crew screen showed a spinner instead of
 * refusing the tap so the crew member could tap again.
 *
 * The holder here takes the trip row `FOR UPDATE` and never lets go in time.
 * The assertion is the error and the clock, not the outcome alone: an
 * unbounded wait shows as "still waiting" at nine seconds, and a refusal for
 * any other reason shows as a different SQLSTATE. Nothing is written by the
 * refused tap, so a retry once the holder commits records it normally.
 */
describePostgres("the crew's tap behind a held trip", () => {
  it("gives up the trip lock after five seconds with the lock-timeout error", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId, bookingId, staffId } = await crewMemberWithASeat(pg.db);
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${tripId} for update`);

    const started = performance.now();
    const tap = recordCrewRollCall(pg.connect(), {
      shopId,
      tripId,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
    }).then(
      (outcome) => ({ settled: "resolved" as const, outcome }),
      (error: unknown) => ({ settled: "rejected" as const, error }),
    );
    const stillWaiting = new Promise<{ settled: "waiting" }>((resolve) => {
      setTimeout(() => resolve({ settled: "waiting" }), 9_000);
    });
    const result = await Promise.race([tap, stillWaiting]);
    const elapsed = performance.now() - started;
    await gate.release();
    await tap;

    expect(result.settled).toBe("rejected");
    const failure = result.settled === "rejected" ? result.error : undefined;
    expect(isLockWaitRefusal(failure)).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(9_000);

    // The refused tap wrote nothing; the retry, once the trip is free, does.
    expect(await onTheWaterByRollCall(pg.db, shopId, tripId, bookingId)).not.toBe("boarded");
    await expect(
      recordCrewRollCall(pg.db, {
        shopId,
        tripId,
        personId: staffId,
        recordedByPersonId: staffId,
        status: "boarded",
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});
