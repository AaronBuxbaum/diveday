import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { boats, shops, trips } from "./schema";
import { readTripPaperIdentity } from "./trip-paper-identity";
import { liveTrip } from "./trips-live";

describe("packet identity reader", () => {
  it("scopes identity to the owning shop and detects trip/boat/shop ABA edits", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(liveTrip(), eq(trips.shopId, shop.id), isNotNull(trips.boatId)))
      .limit(1);
    const before = await readTripPaperIdentity(db, shop.id, trip.id);
    expect(before).not.toBeNull();
    expect(
      await readTripPaperIdentity(db, "00000000-0000-4000-8000-000000000001", trip.id),
    ).toBeNull();
    await db.update(trips).set({ title: "Temporary title" }).where(eq(trips.id, trip.id));
    await db.update(trips).set({ title: trip.title }).where(eq(trips.id, trip.id));
    const afterTrip = await readTripPaperIdentity(db, shop.id, trip.id);
    expect(afterTrip?.title).toBe(before?.title);
    expect(afterTrip?.tripVersion).not.toBe(before?.tripVersion);
    if (!trip.boatId) throw new Error("Seed trip needs an assigned boat");
    const [boat] = await db.select().from(boats).where(eq(boats.id, trip.boatId));
    await db.update(boats).set({ name: "Temporary hull" }).where(eq(boats.id, boat.id));
    await db.update(boats).set({ name: boat.name }).where(eq(boats.id, boat.id));
    const afterBoat = await readTripPaperIdentity(db, shop.id, trip.id);
    expect(afterBoat?.vesselName).toBe(before?.vesselName);
    expect(afterBoat?.boatVersion).not.toBe(afterTrip?.boatVersion);
    await db.update(shops).set({ name: "Temporary shop" }).where(eq(shops.id, shop.id));
    await db.update(shops).set({ name: shop.name }).where(eq(shops.id, shop.id));
    const afterShop = await readTripPaperIdentity(db, shop.id, trip.id);
    expect(afterShop?.shopName).toBe(before?.shopName);
    expect(afterShop?.shopVersion).not.toBe(afterBoat?.shopVersion);
  });
});
