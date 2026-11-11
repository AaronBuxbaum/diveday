// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasActiveCourses } from "../features/courses";
import { countWorkOrders } from "../features/work-orders";
import { fileScopedShopContext, unseededTestDb } from "../test/db";
import { countGearItems } from "./gear";
import { shopHasEverTakenAnOrder } from "./orders";
import { shops } from "./schema";
import { shopRenderFacts } from "./shop-render-facts";
import { countShopTrips } from "./trips";

const ctx = fileScopedShopContext();

describe("shopRenderFacts", () => {
  it("answers what the five separate reads answered, for the seeded shop", async () => {
    const { db, shop } = ctx;
    const facts = await shopRenderFacts(db, shop.id);
    expect(facts).toEqual({
      tripCount: await countShopTrips(db, shop.id),
      everTakenAnOrder: await shopHasEverTakenAnOrder(db, shop.id),
      hasActiveCourses: await hasActiveCourses(db, shop.id),
      gearItemCount: await countGearItems(db, shop.id),
      workOrderCount: await countWorkOrders(db, shop.id),
    });
    expect(facts.tripCount).toBeGreaterThan(0);
    expect(facts.hasActiveCourses).toBe(true);
  });

  it("reports an empty shop as nothing, and reads no other shop's rows", async () => {
    const db = await unseededTestDb();
    const [empty] = await db
      .insert(shops)
      .values({ name: "Empty Shop", slug: "empty-render-facts", timezone: "America/New_York" })
      .returning();
    if (!empty) throw new Error("setup shop insert failed");
    expect(await shopRenderFacts(db, empty.id)).toEqual({
      tripCount: 0,
      everTakenAnOrder: false,
      hasActiveCourses: false,
      gearItemCount: 0,
      workOrderCount: 0,
    });
  });
});
