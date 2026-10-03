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

  it("travels with every seed, lean and minted alike", async () => {
    // The station is site content, not a history-only flourish.
    const lean = await seededShopContext();
    expect((await tideOf(lean.db, lean.shop.id, "Molasses Reef")).stationId).toBe("8723583");

    const { slug } = await createDemoShop(lean.db, { history: false });
    const [minted] = await lean.db.select({ id: shops.id }).from(shops).where(eq(shops.slug, slug));
    if (!minted) throw new Error("minted shop missing");
    expect((await tideOf(lean.db, minted.id, "Molasses Reef")).stationId).toBe("8723583");
  });
});
