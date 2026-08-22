import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  countBoatDepartures,
  createBoat,
  deleteBoat,
  getBoatById,
  getBoatForHistory,
  listBoats,
  updateBoat,
} from "./boats";
import { trips } from "./schema";
import { setShopDivingOptions } from "./shops";
import { createTrip } from "./trips-create";

describe("boats database operations", () => {
  it("creates, retrieves, updates, and lists boats for a shop", async () => {
    const { db, shop } = await seededShopContext();

    const initialBoats = await listBoats(db, shop.id);
    expect(initialBoats.length).toBe(2);

    const boat = await createBoat(db, shop.id, "Sea Explorer", 18);
    expect(boat.name).toBe("Sea Explorer");
    expect(boat.capacity).toBe(18);
    expect(boat.shopId).toBe(shop.id);

    const retrieved = await getBoatById(db, shop.id, boat.id);
    expect(retrieved?.id).toBe(boat.id);
    expect(retrieved?.name).toBe("Sea Explorer");

    const updated = await updateBoat(db, shop.id, boat.id, "Sea Explorer II", 24);
    expect(updated?.name).toBe("Sea Explorer II");
    expect(updated?.capacity).toBe(24);

    const allBoats = await listBoats(db, shop.id);
    expect(allBoats.length).toBe(3);
    expect(allBoats.some((b) => b.name === "Sea Explorer II")).toBe(true);
  });

  /**
   * This used to assert the opposite — that the departure's `boat_id` went
   * `null` — because `deleteBoat` was a real delete and `trips.boat_id` is
   * `onDelete: "set null"`. That behaviour was the bug, not the contract: it
   * erased which vessel sailed on every past departure the hull had carried
   * (issue #680). The assertion is inverted deliberately.
   */
  it("deletes a boat and leaves the departures it carried naming it", async () => {
    const { db, shop } = await seededShopContext();

    const boat = await createBoat(db, shop.id, "Wave Runner", 12);

    const now = new Date("2026-08-17T09:00:00Z");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Morning Reef Dive",
      startsAt: now,
      endsAt: new Date(now.getTime() + 4 * 3600 * 1000),
      capacity: 12,
      plannedDives: 2,
      priceCents: 10000,
      diveMode: "boat",
      boatId: boat.id,
    });
    expect(trip).not.toBeNull();
    if (!trip) throw new Error("trip creation failed");

    expect(trip.boatId).toBe(boat.id);
    expect(trip.diveMode).toBe("boat");

    const deleted = await deleteBoat(db, shop.id, boat.id);
    expect(deleted).toBe(true);

    const [refreshedTrip] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(refreshedTrip.boatId).toBe(boat.id);
    // And the hull is off the fleet the shop has, which is what the staffer asked for.
    expect((await listBoats(db, shop.id)).some((b) => b.id === boat.id)).toBe(false);
  });

  it("updates shop diving options flags (shore and pool diving)", async () => {
    const { db, shop } = await seededShopContext();

    expect(shop.hasShoreDiving).toBe(true);
    expect(shop.hasPoolDiving).toBe(true);

    const updated = await setShopDivingOptions(db, shop.id, {
      hasBoatDiving: true,
      hasShoreDiving: false,
      hasPoolDiving: false,
    });

    expect(updated?.hasShoreDiving).toBe(false);
    expect(updated?.hasPoolDiving).toBe(false);
  });
});

/**
 * **Deleting a hull must not erase which vessel sailed** (issue #680).
 *
 * `deleteBoat` was a real `db.delete()`, and `trips.boat_id` is
 * `onDelete: "set null"` — so it did not fail loudly the way a foreign key
 * normally would. It quietly rewrote every past departure that used the boat to
 * say no vessel was ever recorded: this season's, last season's, and the one an
 * insurer or a coast-guard inquiry asks about first. Nothing warned, nothing
 * counted, nothing could undo it.
 *
 * This is the exact shape ADR 20260820-every-delete-is-soft rules out, and that
 * ADR is explicit the rule is a default for any table holding something a user
 * can delete — not a list of blessed tables.
 */
describe("deleting a boat", () => {
  it("stamps the hull instead of removing it", async () => {
    const { db, shop } = await seededShopContext();
    const boat = await createBoat(db, shop.id, "Reef Runner", 6);

    expect(await deleteBoat(db, shop.id, boat.id)).toBe(true);

    // Gone from the fleet the shop has...
    expect((await listBoats(db, shop.id)).map((b) => b.id)).not.toContain(boat.id);
    expect(await getBoatById(db, shop.id, boat.id)).toBeNull();
    // ...and still on file, which is the whole point.
    const kept = await getBoatForHistory(db, shop.id, boat.id);
    expect(kept?.name).toBe("Reef Runner");
    expect(kept?.deletedAt).toBeInstanceOf(Date);
  });

  it("still names the vessel a past departure sailed on", async () => {
    // The failure this change exists for. Before, the trip's `boat_id` went
    // null and the manifest, the log and the close-out all read as though no
    // boat had ever been recorded.
    const { db, shop } = await seededShopContext();
    const boat = await createBoat(db, shop.id, "Blue Horizon", 12);
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!trip) throw new Error("expected a seeded departure");
    await db.update(trips).set({ boatId: boat.id }).where(eq(trips.id, trip.id));

    await deleteBoat(db, shop.id, boat.id);

    const [after] = await db
      .select({ boatId: trips.boatId })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(after?.boatId).toBe(boat.id);
    expect((await getBoatForHistory(db, shop.id, boat.id))?.name).toBe("Blue Horizon");
  });

  it("counts the departures a delete would touch, so the confirm can say", async () => {
    const { db, shop } = await seededShopContext();
    const boat = await createBoat(db, shop.id, "Sea Fox", 8);
    expect(await countBoatDepartures(db, shop.id, boat.id)).toBe(0);

    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(2);
    for (const row of rows) {
      await db.update(trips).set({ boatId: boat.id }).where(eq(trips.id, row.id));
    }
    expect(await countBoatDepartures(db, shop.id, boat.id)).toBe(rows.length);
  });

  it("refuses to delete the same hull twice, keeping the date it was retired", async () => {
    const { db, shop } = await seededShopContext();
    const boat = await createBoat(db, shop.id, "Second Wind", 6);
    expect(await deleteBoat(db, shop.id, boat.id)).toBe(true);
    const first = (await getBoatForHistory(db, shop.id, boat.id))?.deletedAt;

    // A second tap is not a second retirement — the stamp must keep saying when
    // the shop actually let the boat go.
    expect(await deleteBoat(db, shop.id, boat.id)).toBe(false);
    expect((await getBoatForHistory(db, shop.id, boat.id))?.deletedAt).toEqual(first);
  });

  it("will not rename a hull the shop has deleted", async () => {
    const { db, shop } = await seededShopContext();
    const boat = await createBoat(db, shop.id, "Old Faithful", 6);
    await deleteBoat(db, shop.id, boat.id);

    expect(await updateBoat(db, shop.id, boat.id, "New Name", 10)).toBeNull();
    expect((await getBoatForHistory(db, shop.id, boat.id))?.name).toBe("Old Faithful");
  });
});
