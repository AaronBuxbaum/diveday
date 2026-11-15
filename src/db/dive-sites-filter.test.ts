import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createDiveSite, listDiveSiteMapRows, listDiveSitesPage } from "./dive-sites";

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

  it("draws only the pins the search and chips would list", async () => {
    const { db, shop } = ctx;
    await createDiveSite(db, {
      shopId: shop.id,
      name: "Pin Wreck",
      difficultyLevel: "advanced",
      requiredSpecialties: ["wreck"],
      forecastLatitude: 11,
      forecastLongitude: 11,
    });
    await createDiveSite(db, {
      shopId: shop.id,
      name: "Pin Shallows",
      difficultyLevel: "beginner",
      forecastLatitude: 41,
      forecastLongitude: 41,
    });
    const pins = async (filter: Parameters<typeof listDiveSiteMapRows>[2]) =>
      (await listDiveSiteMapRows(db, shop.id, filter))
        .map((row) => row.name)
        .filter((name) => name.startsWith("Pin "));
    expect(await pins({})).toEqual(["Pin Shallows", "Pin Wreck"]);
    expect(await pins({ difficulty: "beginner" })).toEqual(["Pin Shallows"]);
    expect(await pins({ need: "wreck" })).toEqual(["Pin Wreck"]);
    expect(await pins({ query: "Shallows", need: "wreck" })).toEqual([]);
  });
});
