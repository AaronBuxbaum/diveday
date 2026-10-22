import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DiveSiteTemplate } from "@/content/dive-site-templates";
import { fileScopedShopContext, unseededTestDb } from "@/test/db";
import { countQueries } from "@/test/query-count";
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
import { seedDiveSiteCatalog } from "./seed-dive-site-catalog";

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

function mapTemplate(slug: string, version = 1, latitude = 25): DiveSiteTemplate {
  return {
    slug,
    version,
    area: "florida-keys-upper",
    sources: ["https://example.org/a", "https://example.org/b"],
    briefing: {
      name: slug,
      forecastLatitude: latitude,
      forecastLongitude: -80,
      description: `Published version ${version}`,
    },
  };
}

describe("published catalog map revision", () => {
  it("shares one stable revision across pages and shop presentations without another query", async () => {
    const db = await unseededTestDb();
    const empty = await listGlobalDiveSiteTemplates(db);
    expect(empty.mapRevision).toMatch(/^[a-f0-9]{32}$/);
    expect((await listGlobalDiveSiteTemplates(db)).mapRevision).toBe(empty.mapRevision);

    await seedDiveSiteCatalog(db, [mapTemplate("reef-a"), mapTemplate("reef-b", 1, 27)]);
    const counted = countQueries(db);
    const first = await listGlobalDiveSiteTemplates(counted.db, {
      limit: 1,
      shop: { latitude: 25, longitude: -80, depthUnit: "meters" },
    });
    // The revision rides the count already needed by the pager, rather than
    // adding a new database round trip to every warm map-cache hit.
    expect(counted.count()).toBe(2);
    counted.reset();
    const second = await listGlobalDiveSiteTemplates(counted.db, {
      page: 2,
      limit: 1,
      shop: { latitude: -10, longitude: 150, depthUnit: "feet" },
    });
    expect(counted.count()).toBe(2);
    expect(first.mapRevision).not.toBe(empty.mapRevision);
    expect(second.mapRevision).toBe(first.mapRevision);
    expect(second.templates[0]?.template.id).not.toBe(first.templates[0]?.template.id);
  });

  it("selects a new map cache entry only when a publication changes", async () => {
    const db = await unseededTestDb();
    await seedDiveSiteCatalog(db, [mapTemplate("reef-a")]);
    const first = await listGlobalDiveSiteTemplates(db);
    expect(first.mapRevision).toMatch(/^[a-f0-9]{32}$/);

    await seedDiveSiteCatalog(db, [mapTemplate("reef-a", 1, 30)]);
    expect((await listGlobalDiveSiteTemplates(db)).mapRevision).toBe(first.mapRevision);
    expect((await listGlobalDiveSiteMapRows(db))[0]?.latitude).toBe(25);

    await seedDiveSiteCatalog(db, [mapTemplate("reef-a", 2, 30)]);
    const advanced = await listGlobalDiveSiteTemplates(db);
    expect(advanced.mapRevision).not.toBe(first.mapRevision);
    expect((await listGlobalDiveSiteMapRows(db))[0]).toMatchObject({
      latitude: 30,
      description: "Published version 2",
    });

    await seedDiveSiteCatalog(db, [mapTemplate("reef-b")]);
    const added = await listGlobalDiveSiteTemplates(db);
    expect(added.mapRevision).not.toBe(advanced.mapRevision);
    expect(await listGlobalDiveSiteMapRows(db)).toHaveLength(2);
    // Nonmapped publications are part of the same complete catalog revision.
    await seedDiveSiteCatalog(db, [
      { ...mapTemplate("unmapped"), briefing: { name: "No coordinates" } },
    ]);
    expect((await listGlobalDiveSiteTemplates(db)).mapRevision).not.toBe(added.mapRevision);
    expect(await listGlobalDiveSiteMapRows(db)).toHaveLength(2);
  });

  it("changes keys when a published entry is renamed, replaced or no longer visible", async () => {
    const db = await unseededTestDb();
    const emptyRevision = (await listGlobalDiveSiteTemplates(db)).mapRevision;
    const ids = await seedDiveSiteCatalog(db, [mapTemplate("reef-a")]);
    const id = ids.get("reef-a");
    if (!id) throw new Error("catalog fixture returned no template id");
    const first = await listGlobalDiveSiteTemplates(db);
    expect(first.mapRevision).toMatch(/^[a-f0-9]{32}$/);

    await db
      .update(globalDiveSites)
      .set({ slug: "renamed-reef" })
      .where(eq(globalDiveSites.id, id));
    const renamed = await listGlobalDiveSiteTemplates(db);
    expect(renamed.mapRevision).not.toBe(first.mapRevision);
    expect((await listGlobalDiveSiteMapRows(db))[0]?.slug).toBe("renamed-reef");

    await db.delete(globalDiveSiteVersions).where(eq(globalDiveSiteVersions.globalDiveSiteId, id));
    expect((await listGlobalDiveSiteTemplates(db)).mapRevision).toBe(emptyRevision);
    expect(await listGlobalDiveSiteMapRows(db)).toEqual([]);
    await db.insert(globalDiveSiteVersions).values({
      globalDiveSiteId: id,
      version: 1,
      briefing: mapTemplate("reef-a").briefing,
    });
    const replaced = await listGlobalDiveSiteTemplates(db);
    expect(replaced.mapRevision).not.toBe(renamed.mapRevision);

    await db.update(globalDiveSites).set({ currentVersion: 2 }).where(eq(globalDiveSites.id, id));
    expect((await listGlobalDiveSiteTemplates(db)).mapRevision).toBe(emptyRevision);
    expect(await listGlobalDiveSiteMapRows(db)).toEqual([]);
  });

  it("keeps the current key and rows when a publication rolls back", async () => {
    const db = await unseededTestDb();
    await seedDiveSiteCatalog(db, [mapTemplate("reef-a")]);
    const before = await listGlobalDiveSiteTemplates(db);
    expect(before.mapRevision).toMatch(/^[a-f0-9]{32}$/);

    await expect(
      db.transaction(async (tx) => {
        await seedDiveSiteCatalog(tx, [mapTemplate("reef-a", 2, 30)]);
        throw new Error("publication failed");
      }),
    ).rejects.toThrow("publication failed");

    expect((await listGlobalDiveSiteTemplates(db)).mapRevision).toBe(before.mapRevision);
    expect((await listGlobalDiveSiteMapRows(db))[0]?.latitude).toBe(25);
  });
});
