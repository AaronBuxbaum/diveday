import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  copyDiveSite,
  createDiveSite,
  currentGlobalDiveSiteVersions,
  deleteDiveSite,
  diveSiteLibraryStats,
  importGlobalDiveSiteTemplate,
  listDiveSites,
  listDiveSitesPage,
  listGlobalDiveSiteTemplates,
  updateDiveSite,
} from "./dive-sites";
import { globalDiveSites, globalDiveSiteVersions } from "./schema";

describe("dive-site library", () => {
  /**
   * `dive_sites_shop_name_unique` is a hard (shop_id, name) index and an import
   * cannot choose its own name — it takes the template's. The seeded shop
   * already holds "Molasses Reef" imported at v1, which is the state every demo
   * shop ships in and the one the catalog re-offers that card in, so this is the
   * ordinary path rather than an edge case. Before `availableSiteName` the
   * insert raised an unhandled 23505 and the catalog's only action crashed the
   * page into its error boundary.
   */
  it("imports a catalog template beside a same-named site instead of violating the unique index", async () => {
    const { db, shop } = await seededShopContext();
    const [catalogEntry] = (await listGlobalDiveSiteTemplates(db)).templates;
    if (!catalogEntry) throw new Error("seed: no published dive-site template");

    const first = await importGlobalDiveSiteTemplate(db, shop.id, catalogEntry.template.id);
    expect(first?.name).toBe("Molasses Reef 2");
    const second = await importGlobalDiveSiteTemplate(db, shop.id, catalogEntry.template.id);
    expect(second?.name).toBe("Molasses Reef 3");

    // Independent briefings, all still there — an import never overwrites the
    // copy a shop has already tailored.
    const molasses = (await listDiveSites(db, shop.id))
      .map((site) => site.name)
      .filter((name) => name.startsWith("Molasses Reef"));
    expect(molasses).toEqual(["Molasses Reef", "Molasses Reef 2", "Molasses Reef 3"]);
    expect(second?.sourceTemplateVersion).toBe(catalogEntry.version.version);
  });

  it("keeps the full briefing and readiness gates through create and edit", async () => {
    const { db, shop } = await seededShopContext();

    const site = await createDiveSite(db, {
      shopId: shop.id,
      name: "Molasses North",
      difficulty: "Intermediate",
      depthRange: "30–55 ft",
      currentNote: "Expect a gentle northbound drift.",
      divePlan: "Enter on the mooring and finish at the stern line.",
      landmarks: ["Old anchor", "Sandy swim-through"],
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep", "night"],
      requiresNitrox: true,
    });

    expect(site).toMatchObject({
      difficulty: "Intermediate",
      depthRange: "30–55 ft",
      currentNote: "Expect a gentle northbound drift.",
      divePlan: "Enter on the mooring and finish at the stern line.",
      landmarks: ["Old anchor", "Sandy swim-through"],
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep", "night"],
      requiresNitrox: true,
    });

    const edited = await updateDiveSite(db, shop.id, site.id, {
      shopId: shop.id,
      name: site.name,
      difficulty: "Advanced",
      depthRange: "40–70 ft",
      currentNote: "Check the tide before departure.",
      divePlan: "Follow the reef edge and return along the mooring line.",
      landmarks: ["New anchor"],
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["wreck"],
      requiresNitrox: false,
    });

    expect(edited).toMatchObject({
      difficulty: "Advanced",
      depthRange: "40–70 ft",
      landmarks: ["New anchor"],
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["wreck"],
      requiresNitrox: false,
    });
  });

  it("copies a site into an independent editable briefing", async () => {
    const { db, shop } = await seededShopContext();

    const original = await createDiveSite(db, {
      shopId: shop.id,
      name: "Carysfort Reef",
      forecastLatitude: 25.221,
      forecastLongitude: -80.214,
      marineLife: "Parrotfish, eagle rays",
      imageUrls: ["https://images.example/carysfort.jpg"],
    });
    const copy = await copyDiveSite(db, shop.id, original.id, "Carysfort Reef — private charter");

    expect(copy?.id).not.toBe(original.id);
    expect(copy?.name).toBe("Carysfort Reef — private charter");
    expect(copy?.imageUrls).toEqual(["https://images.example/carysfort.jpg"]);
    expect(copy?.forecastLatitude).toBe(25.221);
    expect(copy?.forecastLongitude).toBe(-80.214);
    expect((await listDiveSites(db, shop.id)).map((site) => site.name)).toContain(
      "Carysfort Reef — private charter",
    );
  });

  it("will not copy another shop's site", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Davis Ledge" });

    expect(
      await copyDiveSite(db, "00000000-0000-0000-0000-000000000000", site.id, "Nope"),
    ).toBeNull();
  });

  it("archives a site while keeping the briefing row intact", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Archive Point" });

    expect(await deleteDiveSite(db, shop.id, site.id)).toBe(true);
    expect((await listDiveSites(db, shop.id)).some((entry) => entry.id === site.id)).toBe(false);
    expect(await copyDiveSite(db, shop.id, site.id, "Should not copy")).toBeNull();
  });
});

/**
 * The library page reads through `listDiveSitesPage`, not `listDiveSites` — a
 * shop that has been running for years holds far more sites than one screen,
 * and before this the page rendered every one of them as a card with no way to
 * find anything. The e2e spec exercises the search band and the "no pager on a
 * single page" contract against the seeded library; the arithmetic below is
 * where paging at real volume is actually pinned down, because seeding 25 sites
 * into the demo shop just to make a pager appear would distort every other
 * surface that reads it.
 */
describe("dive-site library paging and search", () => {
  /** Names sort predictably so a page boundary is a fact, not a coincidence. */
  async function seedSites(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
    count: number,
  ) {
    for (let index = 0; index < count; index += 1) {
      await createDiveSite(db, {
        shopId,
        name: `Paging Site ${String(index).padStart(3, "0")}`,
        locationName: index % 2 === 0 ? "North Wall" : "South Wall",
      });
    }
  }

  it("returns one page at a time with a stable order and an honest total", async () => {
    const { db, shop } = await seededShopContext();
    const seededTotal = (await listDiveSites(db, shop.id)).length;
    await seedSites(db, shop.id, 30);

    const first = await listDiveSitesPage(db, shop.id, {}, { pageSize: 10 });
    expect(first.rows).toHaveLength(10);
    expect(first.total).toBe(seededTotal + 30);
    expect(first.page).toBe(1);
    expect(first.pageCount).toBe(Math.ceil((seededTotal + 30) / 10));

    const second = await listDiveSitesPage(db, shop.id, {}, { page: 2, pageSize: 10 });
    expect(second.rows).toHaveLength(10);
    // No row lands on two pages and none is skipped between them.
    const firstIds = new Set(first.rows.map((site) => site.id));
    expect(second.rows.some((site) => firstIds.has(site.id))).toBe(false);

    const names = [...first.rows, ...second.rows].map((site) => site.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("clamps a page number that could never exist rather than handing the driver a bad offset", async () => {
    const { db, shop } = await seededShopContext();

    for (const requested of [0, -3, Number.NaN]) {
      const page = await listDiveSitesPage(db, shop.id, {}, { page: requested, pageSize: 5 });
      expect(page.page).toBe(1);
      expect(page.rows.length).toBeGreaterThan(0);
    }

    // Past the end lands on the last real page — it used to come back empty
    // under a "Page 999 of 4" heading that could not be true, which is exactly
    // the failure `offsetPage` exists to stop (ADR 20260803-one-pagination-model).
    const beyond = await listDiveSitesPage(db, shop.id, {}, { page: 999, pageSize: 5 });
    expect(beyond.total).toBeGreaterThan(0);
    expect(beyond.page).toBe(beyond.pageCount);
    expect(beyond.rows.length).toBeGreaterThan(0);
    const last = await listDiveSitesPage(db, shop.id, {}, { page: beyond.pageCount, pageSize: 5 });
    expect(beyond.rows.map((site) => site.id)).toEqual(last.rows.map((site) => site.id));
  });

  it("searches the name and the location, case-insensitively, and pages the matches", async () => {
    const { db, shop } = await seededShopContext();
    await seedSites(db, shop.id, 30);

    const byName = await listDiveSitesPage(db, shop.id, { query: "paging site 00" });
    expect(byName.total).toBe(10);
    expect(byName.rows.every((site) => site.name.startsWith("Paging Site 00"))).toBe(true);

    // A location match brings in sites whose *name* says nothing about it.
    const byLocation = await listDiveSitesPage(db, shop.id, { query: "north wall" });
    expect(byLocation.total).toBe(15);

    const paged = await listDiveSitesPage(
      db,
      shop.id,
      { query: "north wall" },
      { page: 2, pageSize: 10 },
    );
    expect(paged.rows).toHaveLength(5);
    expect(paged.pageCount).toBe(2);

    // A whitespace-only search is not a search.
    const blank = await listDiveSitesPage(db, shop.id, { query: "   " });
    expect(blank.total).toBe((await listDiveSites(db, shop.id)).length);

    expect((await listDiveSitesPage(db, shop.id, { query: "nowhere at all" })).total).toBe(0);
  });

  it("never shows one shop's sites to another, searching or paging", async () => {
    const { db, shop } = await seededShopContext();
    await createDiveSite(db, { shopId: shop.id, name: "Shared Name Ledge" });
    const stranger = "00000000-0000-0000-0000-000000000000";

    const searched = await listDiveSitesPage(db, stranger, { query: "Shared Name Ledge" });
    expect(searched.rows).toEqual([]);
    expect(searched.total).toBe(0);

    const unfiltered = await listDiveSitesPage(db, stranger);
    expect(unfiltered.rows).toEqual([]);
    expect(unfiltered.total).toBe(0);
    expect((await diveSiteLibraryStats(db, stranger)).total).toBe(0);
  });

  it("leaves archived sites out of both the page and the counters", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, {
      shopId: shop.id,
      name: "Retired Ledge",
      locationName: "Old Anchorage",
      forecastLatitude: 25.1,
      forecastLongitude: -80.2,
    });
    const before = await diveSiteLibraryStats(db, shop.id);

    expect(await deleteDiveSite(db, shop.id, site.id)).toBe(true);
    const after = await diveSiteLibraryStats(db, shop.id);
    expect(after.total).toBe(before.total - 1);
    expect(after.withForecastPoints).toBe(before.withForecastPoints - 1);
    expect((await listDiveSitesPage(db, shop.id, { query: "Retired Ledge" })).total).toBe(0);
  });

  it("counts the whole library, not the page or the search that is showing", async () => {
    const { db, shop } = await seededShopContext();
    await seedSites(db, shop.id, 30);
    const stats = await diveSiteLibraryStats(db, shop.id);
    const everything = await listDiveSites(db, shop.id);

    expect(stats.total).toBe(everything.length);
    expect(stats.withForecastPoints).toBe(
      everything.filter((site) => site.forecastLatitude !== null && site.forecastLongitude !== null)
        .length,
    );
    expect(stats.fromTemplates).toBe(everything.filter((site) => site.sourceTemplateId).length);
    // The counters are what a staffer trusts to know the library's size, so
    // they must not move when a search narrows the grid below them.
    const narrowed = await listDiveSitesPage(db, shop.id, { query: "north wall" }, { pageSize: 5 });
    expect(narrowed.rows).toHaveLength(5);
    expect((await diveSiteLibraryStats(db, shop.id)).total).toBe(stats.total);
  });
});

/**
 * The DiveDay-published catalog a shop imports from. It is meant to keep
 * growing — the point of it is that a shop anywhere finds its own reef in it —
 * so it pages like every other staff list rather than rendering the whole
 * published set as cards (ADR 20260803-one-pagination-model). The demo ships
 * one template, so the arithmetic is pinned down here rather than by seeding
 * two dozen global rows every other suite would then read.
 */
describe("published dive-site catalog paging", () => {
  async function publishTemplates(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    count: number,
  ) {
    for (let index = 0; index < count; index += 1) {
      const slug = `catalog-site-${String(index).padStart(3, "0")}`;
      const [template] = await db
        .insert(globalDiveSites)
        .values({ slug, currentVersion: 1 })
        .returning();
      if (!template) throw new Error("catalog template insert returned no row");
      await db.insert(globalDiveSiteVersions).values({
        globalDiveSiteId: template.id,
        version: 1,
        briefing: { name: `Catalog Site ${index}`, description: "A published briefing." },
      });
    }
  }

  it("returns one page at a time with an honest total and a stable order", async () => {
    const { db } = await seededShopContext();
    const seeded = (await listGlobalDiveSiteTemplates(db)).total;
    await publishTemplates(db, 30);

    const first = await listGlobalDiveSiteTemplates(db, { limit: 10 });
    expect(first.templates).toHaveLength(10);
    expect(first.total).toBe(seeded + 30);
    expect(first.pageCount).toBe(Math.ceil((seeded + 30) / 10));

    const seen: string[] = [];
    for (let page = 1; page <= first.pageCount; page += 1) {
      const chunk = await listGlobalDiveSiteTemplates(db, { page, limit: 10 });
      expect(chunk.page).toBe(page);
      expect(chunk.total).toBe(first.total);
      seen.push(...chunk.templates.map(({ template }) => template.slug));
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual([...seen].sort((a, b) => a.localeCompare(b, "en")));

    // Past the end lands on the last real page, never an empty grid.
    const beyond = await listGlobalDiveSiteTemplates(db, { page: 999, limit: 10 });
    expect(beyond.page).toBe(beyond.pageCount);
    expect(beyond.templates.length).toBeGreaterThan(0);
  });

  /**
   * The library's "a newer version is published" badge used to index the whole
   * catalog. Now that the catalog pages, reading one page of it would silently
   * drop the badge for every site sourced from a template past that page — so
   * the badge asks for exactly the ids it is rendering instead.
   */
  it("looks up current versions by id, so a badge survives a template past page 1", async () => {
    const { db, shop } = await seededShopContext();
    await publishTemplates(db, 30);
    // `catalog-site-*` sorts after `molasses-reef`, so this one is well past
    // the first page of the catalog the library no longer reads.
    const [late] = await db
      .select()
      .from(globalDiveSites)
      .where(eq(globalDiveSites.slug, "catalog-site-029"));
    if (!late) throw new Error("expected the late template");
    const imported = await importGlobalDiveSiteTemplate(db, shop.id, late.id);
    expect(imported?.sourceTemplateId).toBe(late.id);

    const versions = await currentGlobalDiveSiteVersions(db, [late.id]);
    expect(versions.get(late.id)).toBe(1);

    // Publishing v2 is what the badge is actually watching for.
    await db
      .update(globalDiveSites)
      .set({ currentVersion: 2 })
      .where(eq(globalDiveSites.id, late.id));
    expect((await currentGlobalDiveSiteVersions(db, [late.id])).get(late.id)).toBe(2);

    // An empty ask never reaches the database and never invents an entry.
    expect(await currentGlobalDiveSiteVersions(db, [])).toEqual(new Map());
    expect((await currentGlobalDiveSiteVersions(db, [late.id, late.id])).size).toBe(1);
  });
});
