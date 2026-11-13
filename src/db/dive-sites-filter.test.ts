import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createDiveSite, listDiveSitesPage } from "./dive-sites";

const ctx = fileScopedShopContext();

describe("narrowing the library", () => {
  it("filters by difficulty, dive type and the map's rectangle", async () => {
    const { db, shop } = ctx;
    const names = async (filter: Parameters<typeof listDiveSitesPage>[2]) =>
      (await listDiveSitesPage(db, shop.id, filter)).rows.map((site) => site.name);
    await createDiveSite(db, {
      shopId: shop.id,
      name: "Filter Wreck",
      difficultyLevel: "advanced",
      requiredSpecialties: ["wreck"],
      requiresNitrox: true,
      forecastLatitude: 10,
      forecastLongitude: 10,
    });
    await createDiveSite(db, {
      shopId: shop.id,
      name: "Filter Shallows",
      difficultyLevel: "beginner",
      forecastLatitude: 40,
      forecastLongitude: 40,
    });
    await createDiveSite(db, { shopId: shop.id, name: "Filter Unrated" });

    expect(await names({ query: "Filter", difficulty: "advanced" })).toEqual(["Filter Wreck"]);
    expect(await names({ query: "Filter", difficulty: "unrated" })).toEqual(["Filter Unrated"]);
    expect(await names({ query: "Filter", need: "wreck" })).toEqual(["Filter Wreck"]);
    expect(await names({ query: "Filter", need: "nitrox" })).toEqual(["Filter Wreck"]);
    expect(await names({ query: "Filter", need: "night" })).toEqual([]);
    // A site with no map point is never inside a map area.
    expect(
      await names({ query: "Filter", area: { south: 0, west: 0, north: 20, east: 20 } }),
    ).toEqual(["Filter Wreck"]);
    // Choices compose.
    expect(
      await names({
        query: "Filter",
        difficulty: "beginner",
        area: { south: 0, west: 0, north: 20, east: 20 },
      }),
    ).toEqual([]);
  });
});
