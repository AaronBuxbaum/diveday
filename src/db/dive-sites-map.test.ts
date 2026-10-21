import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  createDiveSite,
  deleteDiveSite,
  listDiveSiteMapRows,
  listDiveSites,
  listDiveSitesPage,
  listGlobalDiveSiteMapRows,
  listGlobalDiveSiteTemplates,
} from "./dive-sites";
import { globalDiveSites, globalDiveSiteVersions } from "./schema";

const ctx = fileScopedShopContext();

describe("dive-site map queries", () => {
  it("returns the full coordinate set outside the visible page and search", async () => {
    const { db, shop } = ctx;
    for (const site of await listDiveSites(db, shop.id)) {
      await deleteDiveSite(db, shop.id, site.id);
    }

    const mapped: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const site = await createDiveSite(db, {
        shopId: shop.id,
        name: `Map Site ${String(index).padStart(2, "0")}`,
        forecastLatitude: 25 + index / 100,
        forecastLongitude: -80 - index / 100,
        description: "A map briefing.",
      });
      mapped.push(site.id);
    }
    const retired = await createDiveSite(db, {
      shopId: shop.id,
      name: "Retired Map Site",
      forecastLatitude: 25.5,
      forecastLongitude: -80.5,
    });
    await deleteDiveSite(db, shop.id, retired.id);
    await createDiveSite(db, { shopId: shop.id, name: "No Map Coordinates" });
    await createDiveSite(db, {
      shopId: shop.id,
      name: "Half Map Coordinates",
      forecastLatitude: 25,
    });

    const firstPage = await listDiveSitesPage(db, shop.id, {}, { pageSize: 20 });
    const noMatchPage = await listDiveSitesPage(
      db,
      shop.id,
      { query: "no matching site" },
      { pageSize: 1 },
    );
    const mapRows = await listDiveSiteMapRows(db, shop.id);

    expect(firstPage.rows).toHaveLength(20);
    expect(noMatchPage.rows).toEqual([]);
    expect(mapRows.map((row) => row.id)).toEqual(mapped);
    expect(await listDiveSiteMapRows(db, "00000000-0000-0000-0000-000000000000")).toEqual([]);
    expect(Object.keys(mapRows[0] ?? {}).sort()).toEqual(
      [
        "description",
        "depthMinMeters",
        "depthRange",
        "difficultyLevel",
        "id",
        "latitude",
        "locationName",
        "longitude",
        "maxDepthMeters",
        "name",
      ].sort(),
    );
  });

  it("includes mapped templates after page one at their current version", async () => {
    const { db } = ctx;
    for (let index = 0; index < 25; index += 1) {
      const slug = `map-catalog-${String(index).padStart(2, "0")}`;
      const [template] = await db
        .insert(globalDiveSites)
        .values({ slug, currentVersion: 1 })
        .returning();
      if (!template) throw new Error("catalog map template insert returned no row");
      await db.insert(globalDiveSiteVersions).values({
        globalDiveSiteId: template.id,
        version: 1,
        briefing: {
          name: `Map Catalog ${String(index).padStart(2, "0")}`,
          forecastLatitude: 25 + index / 100,
          forecastLongitude: -80 - index / 100,
          description: "A current catalog briefing.",
        },
      });
    }

    const [template] = await db
      .insert(globalDiveSites)
      .values({ slug: "map-catalog-versioned", currentVersion: 2 })
      .returning();
    if (!template) throw new Error("versioned catalog map template insert returned no row");
    await db.insert(globalDiveSiteVersions).values([
      {
        globalDiveSiteId: template.id,
        version: 1,
        briefing: {
          name: "Old Map Version",
          forecastLatitude: 25,
          forecastLongitude: -80,
        },
      },
      {
        globalDiveSiteId: template.id,
        version: 2,
        briefing: {
          name: "Current Map Version",
          locationName: "Key Largo",
          forecastLatitude: 25.1,
          forecastLongitude: -80.1,
          description: "Current catalog copy.",
        },
      },
    ]);

    const firstPage = await listGlobalDiveSiteTemplates(db, { limit: 20 });
    const mapRows = await listGlobalDiveSiteMapRows(db);
    const lateTemplate = mapRows.find((row) => row.templateId === template.id);

    expect(firstPage.templates.map(({ template: row }) => row.id)).not.toContain(template.id);
    expect(mapRows.length).toBeGreaterThan(firstPage.templates.length);
    expect(lateTemplate).toMatchObject({
      name: "Current Map Version",
      locationName: "Key Largo",
      latitude: 25.1,
      longitude: -80.1,
      description: "Current catalog copy.",
    });
    expect(mapRows.some((row) => row.name === "Old Map Version")).toBe(false);
  });
});
