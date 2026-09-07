import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { diveSites, shops } from "./schema";

async function tideOf(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  shopId: string,
  name: string,
) {
  const [site] = await db
    .select({ stationId: diveSites.tideStationId, preference: diveSites.tidePreference })
    .from(diveSites)
    .where(and(eq(diveSites.shopId, shopId), eq(diveSites.name, name)))
    .limit(1);
  if (!site) throw new Error(`expected the seeded site "${name}"`);
  return site;
}

describe("seeded tide stations", () => {
  it("reads both Key Largo sites against Carysfort Reef, with the wreck timed to slack", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    expect(await tideOf(db, shop.id, "Molasses Reef")).toEqual({
      stationId: "8723583",
      preference: "any",
    });
    expect(await tideOf(db, shop.id, "Spiegel Grove")).toEqual({
      stationId: "8723583",
      preference: "slack",
    });
    // The rest of the library says nothing about the tide, which is the
    // ordinary state of a site and the state the surfaces must read well in.
    expect(await tideOf(db, shop.id, "French Reef")).toEqual({
      stationId: null,
      preference: "any",
    });
  });

  it("publishes the window to divers on the canonical demo only", async () => {
    const canonical = await seededShopContext({ history: true });
    const [demo] = await canonical.db
      .select({ on: shops.tideWindowPublic })
      .from(shops)
      .where(eq(shops.id, canonical.shop.id));
    expect(demo?.on).toBe(true);

    const lean = await seededShopContext();
    const [minted] = await lean.db
      .select({ on: shops.tideWindowPublic })
      .from(shops)
      .where(eq(shops.id, lean.shop.id));
    expect(minted?.on).toBe(false);
    // The station itself is site content and travels with every seed.
    expect((await tideOf(lean.db, lean.shop.id, "Molasses Reef")).stationId).toBe("8723583");
  });
});
