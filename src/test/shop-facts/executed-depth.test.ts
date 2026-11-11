import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { executedDives, shops, trips } from "../../db/schema/index";
import { DEMO_TODAY_TRIP_TITLE } from "../../db/seed-trips";
import { fileScopedShopContext } from "../db";
import { seedExecutedDepth } from "./executed-depth";

const ctx = fileScopedShopContext();
describe("executed-depth browser fixture", () => {
  it.each([
    ["feet", 18.4404],
    ["meters", 20.4],
    ["feet", null],
  ] as const)("prepares %s and exact %s meter evidence on the named trip", async (unit, meters) => {
    const { db, shop } = ctx;
    const result = await seedExecutedDepth(db, shop.id, { unit, meters });
    const [depth] = await db
      .select()
      .from(executedDives)
      .where(
        and(
          eq(executedDives.shopId, shop.id),
          eq(executedDives.tripId, result.tripId),
          eq(executedDives.diveNumber, 1),
        ),
      );
    expect(depth?.maxDepthMeters).toBe(meters);
    const [savedShop] = await db
      .select({ unit: shops.depthUnit })
      .from(shops)
      .where(eq(shops.id, shop.id));
    expect(savedShop?.unit).toBe(unit);
    const [trip] = await db
      .select({ title: trips.title })
      .from(trips)
      .where(eq(trips.id, result.tripId));
    expect(trip?.title).toBe(DEMO_TODAY_TRIP_TITLE);
  });
});
