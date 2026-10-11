import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { people } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import { loadDiverGear } from "./gear-load";

describe("loadDiverGear", () => {
  it("offers the rent door only when the shop has a fleet and the record is live", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("seeded person missing");

    const live = await loadDiverGear(db, shop, person.id, { removed: false });
    expect(live.hasFleet).toBe(true);
    expect(Array.isArray(live.ownPieces)).toBe(true);
    expect(Array.isArray(live.workOrders)).toBe(true);
    expect(Array.isArray(live.counterRentals)).toBe(true);

    const removed = await loadDiverGear(db, shop, person.id, { removed: true });
    expect(removed.hasFleet).toBe(false);
  });
});
