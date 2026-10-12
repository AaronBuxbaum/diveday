import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { diveSites, shops } from "./schema";

/**
 * **The demo's own depth prose speaks the demo's unit** (dive-domain review of
 * the demo layer). Blue Mantis reads depths in feet, but `depth_range` is the
 * shop's own free text and bypasses the unit entirely, so the seed went on
 * saying "6–12 m" beside a 40 ft maximum. A Florida diver read two units on
 * one briefing.
 */
describe("seeded dive-site depth ranges", () => {
  it("are written in feet when the demo shop reads depths in feet", async () => {
    const { db, shop } = await seededShopContext();
    const [row] = await db
      .select({ depthUnit: shops.depthUnit })
      .from(shops)
      .where(eq(shops.id, shop.id));
    expect(row?.depthUnit).toBe("feet");
    const ranges = await db
      .select({ name: diveSites.name, depthRange: diveSites.depthRange })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id));
    const written = ranges.filter((site) => site.depthRange);
    expect(written.length).toBeGreaterThan(0);
    for (const site of written) {
      expect(site.depthRange, site.name).not.toMatch(/\sm$/);
      expect(site.depthRange, site.name).toMatch(/ft$/);
    }
  });
});
