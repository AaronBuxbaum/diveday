import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBoat } from "@/db/boats";
import { rollCallCrewEvents, trips } from "@/db/schema";
import { createTrip } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { boatClashState } from "./boat-clash";

const ctx = fileScopedShopContext();

describe("boat-clash trouble state", () => {
  it("leaves both boat assignments alone when roll-call evidence refuses the move", async () => {
    const { db, shop } = ctx;
    const now = new Date("2099-06-10T10:00:00.000Z");
    const hostStartsAt = new Date("2099-06-10T13:00:00.000Z");
    const hostEndsAt = new Date("2099-06-10T17:00:00.000Z");
    const moverStartsAt = new Date("2099-06-10T18:00:00.000Z");
    const moverEndsAt = new Date("2099-06-10T22:00:00.000Z");

    await createBoat(db, shop.id, "AAA boat-clash regression hull", 10);
    const host = await createTrip(db, {
      shopId: shop.id,
      title: "Boat-clash regression host",
      startsAt: hostStartsAt,
      endsAt: hostEndsAt,
      capacity: 8,
    });
    const mover = await createTrip(db, {
      shopId: shop.id,
      title: "Boat-clash regression mover",
      startsAt: moverStartsAt,
      endsAt: moverEndsAt,
      capacity: 8,
    });
    if (!host || !mover) throw new Error("boat-clash regression trips were not created");

    const staffId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: mover.id,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date("2099-06-10T12:00:00.000Z"),
    });

    const tripIds = [host.id, mover.id];
    const before = await db
      .select({ id: trips.id, boatId: trips.boatId, startsAt: trips.startsAt })
      .from(trips)
      .where(inArray(trips.id, tripIds))
      .orderBy(trips.startsAt);

    const result = await boatClashState(
      new Request("http://localhost/api/test/seed-trouble-states?boatClash=1"),
      db,
      shop.id,
      now,
    );

    expect(result).toEqual({});
    const after = await db
      .select({ id: trips.id, boatId: trips.boatId, startsAt: trips.startsAt })
      .from(trips)
      .where(inArray(trips.id, tripIds))
      .orderBy(trips.startsAt);
    expect(after).toEqual(before);
    expect(after.map((trip) => trip.boatId)).toEqual([null, null]);
  });
});
