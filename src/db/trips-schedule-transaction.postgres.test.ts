import { and, eq, or, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { createBoat } from "./boats";
import { trips } from "./schema";
import { createTrip, moveTrip } from "./trips";
import { liveTrip } from "./trips-live";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describePostgres("moveTrip transaction composition", () => {
  it("rolls back related writes when the expected companion schedule changes", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db, "Move transaction");
    const hull = await createBoat(pg.db, shop.id, "Move transaction hull", 8);
    const hostStartsAt = new Date("2035-03-12T12:00:00.000Z");
    const hostEndsAt = new Date("2035-03-12T16:00:00.000Z");
    const moverStartsAt = new Date("2035-03-12T17:00:00.000Z");
    const moverEndsAt = new Date("2035-03-12T21:00:00.000Z");
    const host = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Transaction host",
      startsAt: hostStartsAt,
      endsAt: hostEndsAt,
      capacity: 8,
    });
    const mover = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Transaction mover",
      startsAt: moverStartsAt,
      endsAt: moverEndsAt,
      capacity: 8,
    });
    if (!host || !mover) throw new Error("transaction trips missing");

    const hostChanged = deferred();
    const releaseHostChange = deferred();
    const changedHostStartsAt = new Date("2035-03-13T12:00:00.000Z");
    const changedHostEndsAt = new Date("2035-03-13T16:00:00.000Z");
    const hostChange = pg.connect().transaction(async (tx) => {
      await tx
        .update(trips)
        .set({
          startsAt: changedHostStartsAt,
          endsAt: changedHostEndsAt,
          revision: sql`${trips.revision} + 1`,
        })
        .where(and(eq(trips.id, host.id), eq(trips.shopId, shop.id)));
      hostChanged.resolve();
      await releaseHostChange.promise;
    });
    await hostChanged.promise;

    const move = moveTrip(pg.connect(), shop.id, mover.id, hostStartsAt, {
      beforeMove: async (tx) => {
        const assigned = await tx
          .update(trips)
          .set({ boatId: hull.id })
          .where(
            and(
              eq(trips.shopId, shop.id),
              eq(trips.status, "scheduled"),
              liveTrip(),
              or(
                and(
                  eq(trips.id, host.id),
                  eq(trips.startsAt, hostStartsAt),
                  eq(trips.endsAt, hostEndsAt),
                ),
                eq(trips.id, mover.id),
              ),
            ),
          )
          .returning({ id: trips.id });
        if (assigned.length !== 2) throw new Error("host schedule changed before the move");
      },
    });

    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      releaseHostChange.resolve();
    }
    await hostChange;
    await expect(move).rejects.toThrow("host schedule changed before the move");

    const persisted = await pg.db
      .select({ id: trips.id, boatId: trips.boatId, startsAt: trips.startsAt })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), or(eq(trips.id, host.id), eq(trips.id, mover.id))))
      .orderBy(trips.id);
    expect(persisted.find((trip) => trip.id === host.id)).toMatchObject({
      boatId: null,
      startsAt: changedHostStartsAt,
    });
    expect(persisted.find((trip) => trip.id === mover.id)).toMatchObject({
      boatId: null,
      startsAt: moverStartsAt,
    });
  });
});
