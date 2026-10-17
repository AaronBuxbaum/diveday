import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { diveSites, shops } from "./schema";

/**
 * **The demo's depths are numbers in metres, read in the demo's unit** (issue
 * #2426). Blue Mantis reads depths in feet, and a range the seed wrote as prose
 * could name the other unit beside a converted maximum, so a Florida diver read
 * two units on one briefing. The seed now writes `depth_min_meters` and
 * `max_depth_meters`, and every surface prints them through the shop's unit.
 */
describe("seeded dive-site depth ranges", () => {
  it("are recorded as a range in metres, with no prose left to name a unit", async () => {
    const { db, shop } = await seededShopContext();
    const [row] = await db
      .select({ depthUnit: shops.depthUnit })
      .from(shops)
      .where(eq(shops.id, shop.id));
    expect(row?.depthUnit).toBe("feet");
    const sites = await db
      .select({
        name: diveSites.name,
        depthRange: diveSites.depthRange,
        depthMinMeters: diveSites.depthMinMeters,
        maxDepthMeters: diveSites.maxDepthMeters,
      })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id));
    const ranged = sites.filter((site) => site.depthMinMeters !== null);
    expect(ranged.length).toBeGreaterThan(0);
    for (const site of ranged) {
      expect(site.depthRange, site.name).toBeNull();
      expect(site.maxDepthMeters, site.name).not.toBeNull();
      expect(site.depthMinMeters ?? 0, site.name).toBeLessThan(site.maxDepthMeters ?? 0);
    }
  });
});
