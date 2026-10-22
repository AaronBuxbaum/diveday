import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { captureDepartureBoatSafety, departureBoatSafetySnapshot } from "./boat-safety";
import { createBoat } from "./boats";
import { shops, trips } from "./schema";
import { updateTrip } from "./trips-record";

describePostgres("boat snapshot capture against a hull swap", () => {
  it("cannot read the old hull while a swap waits to replace its snapshot", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `Boat race ${suffix}`,
        slug: `boat-race-${suffix}`,
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("shop missing");
    const first = await createBoat(pg.db, shop.id, "First Hull", 12);
    const next = await createBoat(pg.db, shop.id, "Next Hull", 12);
    const startsAt = new Date(nowDate().getTime() + 24 * 3_600_000);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        boatId: first.id,
        title: "Swap race",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        capacity: 10,
      })
      .returning();
    if (!trip) throw new Error("trip missing");
    expect(await captureDepartureBoatSafety(pg.db, shop.id, trip.id)).toBe("captured");

    // Hold only the snapshot. The swap owns the trip and waits here; a
    // concurrent capture must wait on that trip before learning its hull.
    const gate = await holdRowLock(
      pg,
      sql`select id from departure_boat_safety_snapshots where trip_id = ${trip.id} for update`,
    );
    const swap = updateTrip(pg.connect(), shop.id, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      boatId: next.id,
    });
    await waitForLockWaiters(pg.db, 1);
    const capturedAt = new Date(nowDate().getTime() + 1_000);
    const capture = captureDepartureBoatSafety(pg.connect(), shop.id, trip.id, capturedAt);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    expect((await swap).ok).toBe(true);
    expect(await capture).toBe("captured");
    expect(await departureBoatSafetySnapshot(pg.db, shop.id, trip.id)).toMatchObject({
      boatId: next.id,
      boatName: next.name,
      capturedAt,
    });
  });
});
