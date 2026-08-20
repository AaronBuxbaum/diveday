import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBoat, deleteBoat, getBoatById, listBoats, updateBoat } from "./boats";
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

  it("deletes a boat and resets trip references to null", async () => {
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
    expect(refreshedTrip.boatId).toBeNull();
  });

  it("updates shop diving options flags (shore and pool diving)", async () => {
    const { db, shop } = await seededShopContext();

    expect(shop.hasShoreDiving).toBe(true);
    expect(shop.hasPoolDiving).toBe(true);

    const updated = await setShopDivingOptions(db, shop.id, {
      hasShoreDiving: false,
      hasPoolDiving: false,
    });

    expect(updated?.hasShoreDiving).toBe(false);
    expect(updated?.hasPoolDiving).toBe(false);
  });
});
