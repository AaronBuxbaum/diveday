import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { diveNotMadeStanding, recordDiveNotMade, undoDiveNotMade } from "./dive-not-made";
import { recordCrewRollCall } from "./manifests";
import {
  diveNotMadeEvents,
  people,
  personRoles,
  rollCallEvents,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";

/**
 * **"Dive 2 not made" against the first count of dive 2, at once** (issue
 * #4681). Both writers take the trip row's lock, so one waits for the other;
 * whichever goes first, the count stands. Said first, the record is written
 * and the count still lands, and the count then refuses the record again (and
 * wins at every reader, `waterStanding`). Counted first, the record is
 * refused. The gate makes both contenders meet on the lock; the assertions are
 * about the outcome, never the wait (`waitForLockWaiters`).
 */
describePostgres("a dive not made raced against its first count", () => {
  async function fixture() {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Not made ${suffix}`, slug: `not-made-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const [crew] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Sal Moretti" })
      .returning();
    if (!crew) throw new Error("person insert returned no row");
    await pg.db.insert(personRoles).values({ personId: crew.id, role: "owner" });
    await pg.db.insert(userAccounts).values({
      personId: crew.id,
      email: `crew-${suffix}@example.test`,
      hashedPassword: "unused",
      status: "active",
    });
    const left = nowMs() - 2 * 60 * 60 * 1000;
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Not made race",
        startsAt: new Date(left),
        endsAt: new Date(left + 4 * 60 * 60 * 1000),
        capacity: 6,
        plannedDives: 2,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: crew.id });
    const input = { shopId: shop.id, tripId: trip.id, diveNumber: 2, personId: crew.id };
    const notMade = () => recordDiveNotMade(pg.connect(), input);
    const count = () =>
      recordCrewRollCall(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        personId: crew.id,
        recordedByPersonId: crew.id,
        status: "boarded",
        checkpoint: "after_dive_2",
      });
    const gate = () =>
      holdRowLock(pg, sql`select 1 from ${trips} where id = ${trip.id} for update`);
    const counted = async () =>
      pg.db
        .select({ id: rollCallEvents.id })
        .from(rollCallEvents)
        .where(
          and(eq(rollCallEvents.tripId, trip.id), eq(rollCallEvents.checkpoint, "after_dive_2")),
        );
    const words = async () =>
      pg.db
        .select({ word: diveNotMadeEvents.word })
        .from(diveNotMadeEvents)
        .where(eq(diveNotMadeEvents.tripId, trip.id));
    return { pg, input, notMade, count, gate, counted, words, shopId: shop.id, tripId: trip.id };
  }

  it("said first: the record is written, the count still lands, and the count wins", async () => {
    const { pg, input, notMade, count, gate, counted, shopId, tripId } = await fixture();
    const held = await gate();
    const said = notMade();
    await waitForLockWaiters(pg.db, 1);
    const counting = count();
    await waitForLockWaiters(pg.db, 2);
    await held.release();
    expect(await said).toEqual({ ok: true });
    expect(await counting).toMatchObject({ ok: true });
    expect(await counted()).toHaveLength(1);
    // The record stands as written; the count now speaks for the dive, so the
    // record cannot be said again once undone.
    expect([...(await diveNotMadeStanding(pg.db, shopId, tripId)).keys()]).toEqual([2]);
    expect(await undoDiveNotMade(pg.db, input)).toEqual({ ok: true });
    expect(await recordDiveNotMade(pg.db, input)).toEqual({ ok: false, reason: "dive_counted" });
  });

  it("counted first: the record is refused and writes nothing", async () => {
    const { pg, notMade, count, gate, counted, words } = await fixture();
    const held = await gate();
    const counting = count();
    await waitForLockWaiters(pg.db, 1);
    const said = notMade();
    await waitForLockWaiters(pg.db, 2);
    await held.release();
    expect(await counting).toMatchObject({ ok: true });
    expect(await said).toEqual({ ok: false, reason: "dive_counted" });
    expect(await counted()).toHaveLength(1);
    expect(await words()).toEqual([]);
  });
});
