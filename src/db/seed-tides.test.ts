import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { diveSites, shops } from "./schema";
import { createDemoShop } from "./seed";

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

  it("publishes the window to divers on any demo seeded with history", async () => {
    const canonical = await seededShopContext({ history: true });
    const [demo] = await canonical.db
      .select({ on: shops.tideWindowPublic })
      .from(shops)
      .where(eq(shops.id, canonical.shop.id));
    expect(demo?.on).toBe(true);

    const lean = await seededShopContext();
    const [leanShop] = await lean.db
      .select({ on: shops.tideWindowPublic })
      .from(shops)
      .where(eq(shops.id, lean.shop.id));
    expect(leanShop?.on).toBe(false);
    // The station itself is site content and travels with every seed.
    expect((await tideOf(lean.db, lean.shop.id, "Molasses Reef")).stationId).toBe("8723583");
  });

  /**
   * The case above seeds blue-mantis from the lean template; it never mints.
   * This one takes the route `privateShop` actually takes — `createDemoShop`
   * with `history: false` (`/api/test/seed-private-shop`) — because that, and
   * not a slug check inside `seedTides`, is the whole reason a minted shop
   * starts with the toggle off. Make `seedTides` unconditional and this is the
   * test that goes red, along with `e2e/tide-window.spec.ts`, which watches a
   * diver see nothing until the shop switches it on.
   */
  it("leaves the window at the product default on a shop minted without history", async () => {
    const { db } = await seededShopContext();
    const { slug } = await createDemoShop(db, { history: false });
    const [minted] = await db
      .select({ id: shops.id, on: shops.tideWindowPublic })
      .from(shops)
      .where(eq(shops.slug, slug));
    expect(minted?.on).toBe(false);
    // The station is site content and travels to a mint like any other seed.
    expect((await tideOf(db, minted!.id, "Molasses Reef")).stationId).toBe("8723583");
  });
});
