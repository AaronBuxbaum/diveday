import { randomBytes } from "node:crypto";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { bookings, shops, trips } from "./schema";

/**
 * The oversell guard, under genuine contention.
 *
 * `createBookingRecord` opens its transaction with `SELECT ... FOR UPDATE` on
 * the trip row, and the comment above it says why: under READ COMMITTED two
 * transactions would otherwise both read `booked = capacity - 1` and both
 * insert, putting a diver on a boat that has no seat for them. Every existing
 * test of that function runs on PGlite, which is single-connection — so the
 * lock has never once been contended in CI, and deleting the `.for("update")`
 * would leave the whole suite green. This file is the one place that is not
 * true (docs/engineering/testing.md; the same gap is stated from the money side
 * in `src/db/money-replay.test.ts`).
 *
 * ## Why the tests hold a gate open
 *
 * Firing two `createBooking` calls with `Promise.all` and asserting one won
 * proves nothing: the first can finish and commit before the second's `BEGIN`,
 * and the assertion passes for that sequential run exactly as it does for a
 * contended one. So a third connection takes the trip row's lock first, the
 * contenders are started, and the test waits until Postgres itself reports them
 * *both* parked on that lock (`waitForLockWaiters`) before releasing it. Only
 * then is the gate dropped, so every contender is inside its transaction at the
 * same instant and the race is a fact of the run rather than a hope.
 *
 * ## Which assertion actually catches a missing guard
 *
 * The gate proves *simultaneity*; the **seat count** proves the *guard*. Those
 * are two different jobs and it is worth being exact about which does which,
 * because the obvious reading — "no `FOR UPDATE` means nobody blocks, so
 * `waitForLockWaiters` times out" — is wrong, and a future reader who believes
 * it might delete the seat-count assertions as redundant.
 *
 * They are not. A contender blocks on the gate whether or not the code under
 * test locks anything: its `INSERT` into `bookings` carries a foreign key to
 * `trips`, and the FK check takes a `KEY SHARE` lock on that trip row, which
 * conflicts with the gate's `FOR UPDATE`. So `waitForLockWaiters` succeeds
 * either way.
 *
 * This was measured, not reasoned about. Deleting the `.for("update")` on
 * `src/db/bookings.ts`'s trip read and rerunning this file: `waitForLockWaiters`
 * still passed, and the tests failed on the outcome instead — the one-seat trip
 * sold **2** seats, and the two-seat trip sold **5**. That is the oversell this
 * file exists to make impossible to ship, and the `expect(...seatsTaken...)`
 * lines are what report it.
 */

const HOUR_MS = 60 * 60 * 1000;

/** A shop with one departure, `capacity` seats, sailing tomorrow. */
async function tripWithSeats(db: AppDb, capacity: number) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Race Test Divers ${suffix}`,
      slug: `race-test-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  // Relative to the frozen clock the whole suite runs on, not the wall clock:
  // `createBookingRecord` refuses a departure at or before `nowDate()`.
  const startsAt = new Date(nowDate().getTime() + 24 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  return { shopId: shop.id, tripId: trip.id };
}

/** The lock `createBookingRecord` takes first, held open by the starting gate. */
const tripRowLock = (tripId: string) => sql`select id from trips where id = ${tripId} for update`;

/** Seats actually sold on a trip, counted the way the capacity gate counts them. */
async function seatsTaken(db: AppDb, tripId: string): Promise<number> {
  const [row] = await db
    .select({ booked: count(bookings.id) })
    .from(bookings)
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
  return row?.booked ?? 0;
}

describePostgres("createBooking under real concurrency", () => {
  it("admits exactly one of two transactions racing for the last seat", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId } = await tripWithSeats(pg.db, 1);

    const gate = await holdRowLock(pg, tripRowLock(tripId));
    // Two genuinely separate connections, so these are two separate Postgres
    // backends — not two awaits interleaved on one.
    const first = createBooking(pg.connect(), {
      actor: "staff",
      shopId,
      tripId,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    const second = createBooking(pg.connect(), {
      actor: "staff",
      shopId,
      tripId,
      fullName: "Ravi Chandra",
      email: "ravi@example.com",
    });

    // Both are now inside their transactions and parked on the trip row, so
    // releasing the gate starts them from the same instant. This makes the race
    // real; it is not what detects a missing guard (see the header).
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, reason: "trip_full" }]);
    // The refusal is not the point on its own — the seat count is, and this is
    // the line that fails when the `FOR UPDATE` goes away: an oversell reads as
    // 2 here even though both callers were told "ok".
    expect(await seatsTaken(pg.db, tripId)).toBe(1);
  });

  it("sells a two-seat trip to exactly two of five simultaneous bookings", async () => {
    // Contention past a single pair, where an off-by-one in the `booked >=
    // capacity` comparison stops being invisible: with five contenders a guard
    // that lets one extra through sells three seats, not two.
    const pg = await postgresTestDb();
    const { shopId, tripId } = await tripWithSeats(pg.db, 2);

    const gate = await holdRowLock(pg, tripRowLock(tripId));
    const contenders = ["ana", "ben", "cleo", "dev", "esi"].map((name) =>
      createBooking(pg.connect(), {
        actor: "staff",
        shopId,
        tripId,
        fullName: name,
        email: `${name}@example.com`,
      }),
    );

    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(2);
    expect(
      outcomes.filter((outcome) => !outcome.ok && outcome.reason === "trip_full"),
    ).toHaveLength(3);
    expect(await seatsTaken(pg.db, tripId)).toBe(2);
  });

  it("does not double-book one diver submitting the same booking twice at once", async () => {
    // The other race the booking transaction carries: two identical submissions
    // (a double-tapped Book button on a flaky connection) dedupe onto one person
    // row and one seat, rather than colliding on `bookings_trip_person_unique`
    // and surfacing as a 500.
    //
    // Unlike the two above, this one survives the `FOR UPDATE` being deleted —
    // measured, same experiment as the header describes. That is not a weakness
    // in the test, it is the point: here the unique index is the backstop, and
    // what is being checked is that the collision is turned into a clean
    // `already_booked` refusal instead of an unhandled constraint violation.
    // The oversell tests above are what hold the lock itself to account.
    const pg = await postgresTestDb();
    const { shopId, tripId } = await tripWithSeats(pg.db, 4);

    const gate = await holdRowLock(pg, tripRowLock(tripId));
    const submissions = [pg.connect(), pg.connect()].map((db) =>
      createBooking(db, {
        actor: "public",
        shopId,
        tripId,
        fullName: "Nora Quinn",
        email: "nora@example.com",
      }),
    );

    await waitForLockWaiters(pg.db, submissions.length);
    await gate.release();

    const outcomes = await Promise.all(submissions);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, reason: "already_booked" },
    ]);
    expect(await seatsTaken(pg.db, tripId)).toBe(1);
  });
});
