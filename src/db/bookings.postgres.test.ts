import { randomBytes } from "node:crypto";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking, createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { bookings, people, personRoles, shops, trips } from "./schema";

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

/** A second departure at the same shop, so one party can name the other's divers. */
async function anotherTripIn(db: AppDb, shopId: string, capacity: number): Promise<string> {
  const startsAt = new Date(nowDate().getTime() + 48 * HOUR_MS);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: "Night Dive",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS),
      capacity,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  return trip.id;
}

/** A diver this shop already holds, so a party naming them takes a lock rather than an insert. */
async function existingDiver(db: AppDb, shopId: string, fullName: string, email: string) {
  const [person] = await db.insert(people).values({ shopId, fullName, email }).returning();
  if (!person) throw new Error("person insert returned no row");
  await db.insert(personRoles).values({ personId: person.id, role: "diver" });
  return person;
}

/** The lock the declaration pass takes, held open by the starting gate. */
const personRowLock = (personId: string) =>
  sql`select id from people where id = ${personId} for update`;

/**
 * The party booking's `people` lock order (issue #654).
 *
 * `recordSelfDeclaredCards` opens with `SELECT ... FOR UPDATE` on the diver, and
 * a lock taken inside a transaction is held to commit — so a six-member party
 * holds six of them. While the declaration was written from inside the per-seat
 * path, they were taken in the order the form posted its fieldsets, and two
 * parties on *different* trips naming the same two divers in opposite order took
 * the same two locks in opposite order. Postgres broke the cycle with `40P01`,
 * which is not a `PartyBookingError` and so escaped `createBookingParty`'s catch
 * as an unhandled error: the diver got a crash, not "that seat just went".
 *
 * This is the file where that is provable. PGlite is single-connection and
 * cannot hold two transactions open at once, so the unit suite can assert the
 * write *order* but never the crash it prevents.
 */
describePostgres("createBookingParty under real concurrency", () => {
  it("does not deadlock when two parties name the same divers in opposite order", async () => {
    const pg = await postgresTestDb();
    const { shopId, tripId: reefTripId } = await tripWithSeats(pg.db, 4);
    const nightTripId = await anotherTripIn(pg.db, shopId, 4);

    const nora = await existingDiver(pg.db, shopId, "Nora Quinn", "nora@example.com");
    const ravi = await existingDiver(pg.db, shopId, "Ravi Chandra", "ravi@example.com");
    // Named by the order the *fix* puts them in, not by the order they were
    // created: the sort is on the resolved id, so which of the two is locked
    // first is a property of the rows, not of this test's setup.
    const [first, second] = [nora, ravi].sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!first || !second) throw new Error("expected two divers");

    const member = (tripId: string, person: { fullName: string; email: string | null }) => ({
      actor: "public" as const,
      shopId,
      tripId,
      fullName: person.fullName,
      // The name must match the row it resolves to, or `identityUnconfirmed`
      // skips the declaration entirely (H-13) and no lock is ever taken.
      email: person.email ?? "",
      declared: { level: "rescue" as const },
      // These trips carry no requirement row, so nothing is being talked past;
      // it is here so an unrelated future gate cannot turn this into a refusal
      // and quietly stop exercising the declaration write at all.
      admissionGate: "advise" as const,
    });

    // The gate holds the row both parties want first once they agree on an
    // order — and the row the *submitted* order makes them disagree about.
    const gate = await holdRowLock(pg, personRowLock(first.id));

    // Staged, not fired together, and that is what makes the old failure
    // deterministic rather than a coin flip. Against the per-seat write, the
    // reef party parks on `first` while the night party takes `second` free and
    // then parks on `first` behind it; releasing the gate hands `first` to the
    // reef party, which then wants `second` — held by the night party, which is
    // still waiting on `first`. That is the cycle, every run.
    const reefParty = createBookingParty(pg.connect(), [
      member(reefTripId, first),
      member(reefTripId, second),
    ]);
    await waitForLockWaiters(pg.db, 1);
    const nightParty = createBookingParty(pg.connect(), [
      member(nightTripId, second),
      member(nightTripId, first),
    ]);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    // `createBookingParty` rethrows anything that is not a `PartyBookingError`,
    // so a `40P01` surfaces here as a rejection. Settled rather than awaited so
    // the failure message names the deadlock instead of just failing the file.
    const settled = await Promise.allSettled([reefParty, nightParty]);
    expect(settled.filter((r) => r.status === "rejected").map((r) => String(r.reason))).toEqual([]);

    // Both parties seated: the fix serializes them, it does not refuse one.
    expect(settled.map((r) => r.status === "fulfilled" && r.value.ok)).toEqual([true, true]);
    expect(await seatsTaken(pg.db, reefTripId)).toBe(2);
    expect(await seatsTaken(pg.db, nightTripId)).toBe(2);
  });

  it("does not deadlock when one diver is booked onto two trips at once", async () => {
    // The **other** deadlock, and the one an ordering rule cannot reach: it is
    // a lock upgrade on a single row, so there is no second lock to put in a
    // different order. Inserting a `bookings` row takes `FOR KEY SHARE` on the
    // diver it names, held to commit; `recordSelfDeclaredCards` then asked for
    // `FOR UPDATE` on that same tuple, which conflicts with it. Two bookings of
    // one diver therefore each held a key-share the other's upgrade was waiting
    // to see released — Postgres reported it against `tuple (0,1)`, one row.
    //
    // This one is not about parties at all: two *single* bookings of the same
    // returning diver are enough, which is an ordinary Saturday at a shop whose
    // regulars book a morning and an afternoon departure.
    const pg = await postgresTestDb();
    const { shopId, tripId: reefTripId } = await tripWithSeats(pg.db, 4);
    const nightTripId = await anotherTripIn(pg.db, shopId, 4);
    const nora = await existingDiver(pg.db, shopId, "Nora Quinn", "nora@example.com");

    // `FOR UPDATE` on the diver conflicts with the key-share each booking's
    // foreign key needs, so both park at their insert and neither can reach its
    // declaration write until the gate drops — which is what puts them both
    // inside the window where the upgrade used to cross.
    const gate = await holdRowLock(pg, personRowLock(nora.id));
    const both = [reefTripId, nightTripId].map((tripId) =>
      createBooking(pg.connect(), {
        actor: "public" as const,
        shopId,
        tripId,
        fullName: nora.fullName,
        email: nora.email ?? "",
        declared: { level: "rescue" as const },
        admissionGate: "advise" as const,
      }),
    );
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const settled = await Promise.allSettled(both);
    expect(settled.filter((r) => r.status === "rejected").map((r) => String(r.reason))).toEqual([]);
    expect(settled.map((r) => r.status === "fulfilled" && r.value.ok)).toEqual([true, true]);
    expect(await seatsTaken(pg.db, reefTripId)).toBe(1);
    expect(await seatsTaken(pg.db, nightTripId)).toBe(1);
  });
});
