import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  copyDiveSite,
  createDiveSite,
  createDiveSiteForForm,
  currentGlobalDiveSiteVersions,
  deleteDiveSite,
  diveSiteLibrarySize,
  getDiveSiteTemplateUpdate,
  importGlobalDiveSiteTemplate,
  listDiveSites,
  listDiveSitesPage,
  listGlobalDiveSiteTemplates,
  pullDiveSiteTemplateUpdates,
  SITE_EDIT_CONFLICT,
  SITE_NAME_TAKEN,
  shopSearchAnchor,
  undoDiveSiteTemplateUpdate,
  updateDiveSite,
  updateDiveSiteForForm,
} from "./dive-sites";
import { diveSites, globalDiveSites, globalDiveSiteVersions } from "./schema";

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
    // By name, not "the first card": the catalog is a real library of Florida
    // sites ordered by slug now, and only this one collides with a site the
    // seeded shop already holds — which is the collision under test.
    const catalogEntry = (await listGlobalDiveSiteTemplates(db)).templates.find(
      (row) => row.version.briefing.name === "Molasses Reef",
    );
    if (!catalogEntry) throw new Error("seed: no published Molasses Reef template");

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

  it("pulls a newer template revision without overwriting a local edit", async () => {
    const { db, shop } = await seededShopContext();
    const catalogEntry = (await listGlobalDiveSiteTemplates(db)).templates.find(
      (row) => row.version.briefing.name === "Molasses Reef",
    );
    if (!catalogEntry) throw new Error("seed: no published Molasses Reef template");
    const imported = await importGlobalDiveSiteTemplate(db, shop.id, catalogEntry.template.id);
    if (!imported) throw new Error("expected a catalog copy");

    await db.insert(globalDiveSiteVersions).values({
      globalDiveSiteId: catalogEntry.template.id,
      version: 3,
      briefing: {
        ...catalogEntry.version.briefing,
        description: "A newly expanded published briefing.",
      },
    });
    await db
      .update(globalDiveSites)
      .set({ currentVersion: 3 })
      .where(eq(globalDiveSites.id, catalogEntry.template.id));
    await db
      .update(diveSites)
      .set({ description: "Our local briefing for this boat." })
      .where(eq(diveSites.id, imported.id));

    const pending = await getDiveSiteTemplateUpdate(db, shop.id, imported.id);
    expect(pending?.currentVersion).toBe(2);
    expect(pending?.latestVersion).toBe(3);
    expect(pending?.diff.some((change) => change.field === "description")).toBe(true);

    const result = await pullDiveSiteTemplateUpdates(
      db,
      shop.id,
      imported.id,
      "preserve-shop-edits",
    );
    expect(result.status).toBe("updated");
    const [updated] = await db.select().from(diveSites).where(eq(diveSites.id, imported.id));
    expect(updated?.sourceTemplateVersion).toBe(3);
    expect(updated?.description).toBe("Our local briefing for this boat.");

    const undone = await undoDiveSiteTemplateUpdate(db, shop.id, imported.id);
    expect(undone.status).toBe("undone");
    const [restored] = await db.select().from(diveSites).where(eq(diveSites.id, imported.id));
    expect(restored?.sourceTemplateVersion).toBe(catalogEntry.version.version);
    expect(restored?.description).toBe("Our local briefing for this boat.");
    expect(restored?.templateUpdateUndo).toBeNull();
    expect((await undoDiveSiteTemplateUpdate(db, shop.id, imported.id)).status).toBe("unavailable");
  });

  /**
   * A production save of "Christ of the Abyss" on 2026-08-14 threw the raw
   * 23505 out of the edit action: a 500 error page, and the whole briefing the
   * staffer had typed gone with it. The name is the one rule the form's parse
   * cannot check, so the database refuses it — and a refusal has to come back
   * as an answer the form can word, like every other one.
   */
  it("answers a name the shop already holds instead of throwing the unique violation", async () => {
    const { db, shop } = await seededShopContext();
    // A name off the shop's own library rather than a literal: the site the
    // production save collided with was one the shop had imported from the
    // catalog, which is how most of a shop's sites arrive.
    const [existing] = await listDiveSites(db, shop.id);
    if (!existing) throw new Error("seed: demo shop has no dive sites");

    expect(await createDiveSiteForForm(db, { shopId: shop.id, name: existing.name })).toBe(
      SITE_NAME_TAKEN,
    );

    const other = await createDiveSite(db, { shopId: shop.id, name: "Rename Me Reef" });
    expect(
      await updateDiveSiteForForm(db, shop.id, other.id, { shopId: shop.id, name: existing.name }),
    ).toBe(SITE_NAME_TAKEN);
    // Refused, not half-applied: the site the staffer was editing is untouched.
    expect((await listDiveSites(db, shop.id)).find((s) => s.id === other.id)?.name).toBe(
      "Rename Me Reef",
    );
  });

  /**
   * The index does not exclude archived sites, so a name can be held by a row
   * that is nowhere in the staffer's library — which is why the refusal is
   * worded to mention them rather than sending someone hunting for a site they
   * cannot see.
   */
  it("refuses a name an archived site still holds", async () => {
    const { db, shop } = await seededShopContext();
    const archived = await createDiveSite(db, { shopId: shop.id, name: "Retired Ledge" });
    await deleteDiveSite(db, shop.id, archived.id);
    // Gone from the library the staffer can see...
    expect((await listDiveSites(db, shop.id)).map((site) => site.name)).not.toContain(
      "Retired Ledge",
    );

    // ...and still holding its name, which is what the wording has to explain.
    expect(await createDiveSiteForForm(db, { shopId: shop.id, name: "Retired Ledge" })).toBe(
      SITE_NAME_TAKEN,
    );
  });

  it("keeps the full briefing and readiness gates through create and edit", async () => {
    const { db, shop } = await seededShopContext();

    const site = await createDiveSite(db, {
      shopId: shop.id,
      name: "Molasses North",
      difficultyLevel: "intermediate" as const,
      depthRange: "30–55 ft",
      currentNote: "Expect a gentle northbound drift.",
      divePlan: "Enter on the mooring and finish at the stern line.",
      landmarks: ["Old anchor", "Sandy swim-through"],
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep", "night"],
      requiresNitrox: true,
    });

    expect(site).toMatchObject({
      difficultyLevel: "intermediate" as const,
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
      difficultyLevel: "advanced" as const,
      depthRange: "40–70 ft",
      currentNote: "Check the tide before departure.",
      divePlan: "Follow the reef edge and return along the mooring line.",
      landmarks: ["New anchor"],
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["wreck"],
      requiresNitrox: false,
    });

    expect(edited).toMatchObject({
      difficultyLevel: "advanced" as const,
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
describe("the shop's search anchor", () => {
  /**
   * The address type-ahead has to send Amazon Location *some* geographic
   * anchor — it refuses a request carrying none — and a shop's own dive sites
   * are the only lat/lng this app stores for a shop.
   */
  it("is a dive site's forecast coordinate, as [longitude, latitude]", async () => {
    const { db, shop } = await seededShopContext();
    // Sorts first by name, so it is the one a stable anchor must pick.
    await createDiveSite(db, {
      shopId: shop.id,
      name: "AAA Anchor Reef",
      forecastLatitude: 25.0117,
      forecastLongitude: -80.4,
    });

    expect(await shopSearchAnchor(db, shop.id)).toEqual({
      longitude: -80.4,
      latitude: 25.0117,
    });
  });

  it("stays on the same site across calls, so a bias never wobbles mid-search", async () => {
    // A bias that moved between keystrokes would reshuffle a list the staffer
    // is part-way through reading.
    const { db, shop } = await seededShopContext();
    await createDiveSite(db, {
      shopId: shop.id,
      name: "AAA Anchor Reef",
      forecastLatitude: 25.0117,
      forecastLongitude: -80.4,
    });
    await createDiveSite(db, {
      shopId: shop.id,
      name: "AAB Second Reef",
      forecastLatitude: 18.3,
      forecastLongitude: -78.1,
    });

    const first = await shopSearchAnchor(db, shop.id);
    expect(await shopSearchAnchor(db, shop.id)).toEqual(first);
    expect(first).toEqual({ longitude: -80.4, latitude: 25.0117 });
  });

  it("skips a site that carries only one half of a coordinate", async () => {
    // Both columns are independently nullable, and half a coordinate is not a
    // position — biasing to longitude 0 would be a different ocean.
    const { db, shop } = await seededShopContext();
    for (const site of await listDiveSites(db, shop.id)) {
      await deleteDiveSite(db, shop.id, site.id);
    }
    await createDiveSite(db, {
      shopId: shop.id,
      name: "AAA Half A Coordinate",
      forecastLatitude: 25.0117,
    });

    expect(await shopSearchAnchor(db, shop.id)).toBeNull();
  });

  it("is null for a shop with no sited water yet, rather than an invented centre", async () => {
    const { db, shop } = await seededShopContext();
    for (const site of await listDiveSites(db, shop.id)) {
      await deleteDiveSite(db, shop.id, site.id);
    }
    expect(await shopSearchAnchor(db, shop.id)).toBeNull();
  });
});

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
    expect(await diveSiteLibrarySize(db, stranger)).toBe(0);
  });

  it("leaves deleted sites out of both the page and the count", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, {
      shopId: shop.id,
      name: "Retired Ledge",
      locationName: "Old Anchorage",
      forecastLatitude: 25.1,
      forecastLongitude: -80.2,
    });
    const before = await diveSiteLibrarySize(db, shop.id);

    expect(await deleteDiveSite(db, shop.id, site.id)).toBe(true);
    expect(await diveSiteLibrarySize(db, shop.id)).toBe(before - 1);
    expect((await listDiveSitesPage(db, shop.id, { query: "Retired Ledge" })).total).toBe(0);
  });

  it("counts the whole library, not the page or the search that is showing", async () => {
    const { db, shop } = await seededShopContext();
    await seedSites(db, shop.id, 30);
    const size = await diveSiteLibrarySize(db, shop.id);
    const everything = await listDiveSites(db, shop.id);

    expect(size).toBe(everything.length);
    // The count is the one question the library page asks it — "is there
    // anything here at all?" — and it decides between the day-one empty state
    // and the searchable table. So it must not move when a search narrows the
    // table below it, or a shop whose search matched nothing would be shown
    // "start your first site" on top of its thirty.
    const narrowed = await listDiveSitesPage(db, shop.id, { query: "north wall" }, { pageSize: 5 });
    expect(narrowed.rows).toHaveLength(5);
    expect(await diveSiteLibrarySize(db, shop.id)).toBe(size);
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

/**
 * **Two staffers with the same briefing open.**
 *
 * A site posts its *whole* page — twenty-odd fields, the landmark list, the
 * field guide, the route — so the second save does not overwrite one field
 * between them: it reverts every section to whatever the row held when that tab
 * opened. It used to do that silently (issue #820).
 */
describe("a dive-site briefing saved from two tabs", () => {
  /** The generation a rendered page would carry in its hidden field. */
  const generationOf = (site: { updatedAt: Date | null; createdAt: Date }) =>
    site.updatedAt ?? site.createdAt;

  it("refuses the second save rather than reverting the first", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Two Tabs Reef" });
    const opened = generationOf(site);

    const first = await updateDiveSiteForForm(
      db,
      shop.id,
      site.id,
      { shopId: shop.id, name: "Two Tabs Reef", currentNote: "Ripping on the flood." },
      { expectedUpdatedAt: opened, now: new Date(site.createdAt.getTime() + 60_000) },
    );
    expect(first).not.toBe(SITE_EDIT_CONFLICT);

    // The second tab still holds the generation it opened with.
    expect(
      await updateDiveSiteForForm(
        db,
        shop.id,
        site.id,
        { shopId: shop.id, name: "Two Tabs Reef" },
        { expectedUpdatedAt: opened },
      ),
    ).toBe(SITE_EDIT_CONFLICT);
    // Refused, not half-applied: the first writer's note is still on the row.
    const [after] = await db.select().from(diveSites).where(eq(diveSites.id, site.id));
    expect(after?.currentNote).toBe("Ripping on the flood.");
  });

  /**
   * The rows most likely to be edited by two people are the ones nobody has
   * saved since the column arrived, and their `updated_at` is null. Comparing
   * that column alone would leave protection switched off for exactly those.
   */
  it("protects a site that has never been saved, whose updated_at is null", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Never Saved Reef" });
    expect(site.updatedAt).toBeNull();

    await updateDiveSiteForForm(
      db,
      shop.id,
      site.id,
      { shopId: shop.id, name: "Never Saved Reef" },
      { expectedUpdatedAt: site.createdAt },
    );
    expect(
      await updateDiveSiteForForm(
        db,
        shop.id,
        site.id,
        { shopId: shop.id, name: "Never Saved Reef" },
        { expectedUpdatedAt: site.createdAt },
      ),
    ).toBe(SITE_EDIT_CONFLICT);
  });

  /**
   * A page rendered by the previous release sends no hidden field at all, and
   * the migration runs while that release is still serving (AGENTS.md's
   * expand/contract rule). Refusing those would break saves for as long as the
   * two overlap, so no information means allow.
   */
  it("allows a save that carries no generation at all", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Old Release Reef" });
    await updateDiveSiteForForm(
      db,
      shop.id,
      site.id,
      { shopId: shop.id, name: "Old Release Reef", currentNote: "first" },
      { expectedUpdatedAt: site.createdAt },
    );
    const written = await updateDiveSiteForForm(db, shop.id, site.id, {
      shopId: shop.id,
      name: "Old Release Reef",
      currentNote: "second",
    });
    expect(written).not.toBe(SITE_EDIT_CONFLICT);
    expect(written).not.toBeNull();
  });

  /**
   * Another shop's site is *missing*, never a conflict. A conflict would be an
   * answer about a row the caller may not read, which is how a tenant boundary
   * turns into an existence oracle.
   */
  it("says missing rather than conflict for another shop's site", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Other Shop Reef" });
    expect(
      await updateDiveSiteForForm(
        db,
        randomUUID(),
        site.id,
        { shopId: shop.id, name: "Other Shop Reef" },
        { expectedUpdatedAt: site.createdAt },
      ),
    ).toBeNull();
  });

  /** A deleted site is gone to the editor, whatever generation the tab holds. */
  it("says missing rather than conflict for a deleted site", async () => {
    const { db, shop } = await seededShopContext();
    const site = await createDiveSite(db, { shopId: shop.id, name: "Deleted Reef" });
    await deleteDiveSite(db, shop.id, site.id);
    expect(
      await updateDiveSiteForForm(
        db,
        shop.id,
        site.id,
        { shopId: shop.id, name: "Deleted Reef" },
        { expectedUpdatedAt: site.createdAt },
      ),
    ).toBeNull();
  });
});
