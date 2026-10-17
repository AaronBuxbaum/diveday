import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { briefingInUnit } from "@/lib/site-prose-units";
import {
  convertImportedSiteProseToUnit,
  getDiveSiteTemplateUpdate,
  getGlobalDiveSiteTemplate,
  importGlobalDiveSiteTemplate,
  listGlobalDiveSiteTemplates,
} from "./dive-sites";
import { diveSites, globalDiveSites, globalDiveSiteVersions } from "./schema";
import { setShopDepthUnit } from "./shops";

const ctx = fileScopedShopContext();

/** A measure in metres: "12 m", "18–30 m", "4.5 m". */
const METRIC = /\b\d+(\.\d+)?(–\d+(\.\d+)?)? ?m\b/;

/**
 * **The catalog reads in the shop's own unit** (fourth review, item 46). The
 * catalog is written in metres, and a feet shop's copy said "a ship's winch in
 * about 12 m" under a "20–40 ft" header. The demo shop reads feet.
 */
describe("the dive-site catalog in a feet shop's unit", () => {
  async function templateWithMetricLandmark() {
    const entry = (await listGlobalDiveSiteTemplates(ctx.db, { limit: 1000 })).templates.find(
      (row) =>
        (row.version.briefing.landmarks ?? []).some((landmark) => METRIC.test(landmark.note)),
    );
    if (!entry) throw new Error("seed: no template with a metric landmark");
    return entry;
  }

  it("imports the measures in feet, and a later revision does not read them as edits", async () => {
    const { db, shop } = ctx;
    expect(shop.depthUnit).toBe("feet");
    const catalogEntry = await templateWithMetricLandmark();
    const imported = await importGlobalDiveSiteTemplate(db, shop.id, catalogEntry.template.id);
    if (!imported) throw new Error("expected a catalog copy");
    const notes = (imported.landmarks as { note: string }[]).map((landmark) => landmark.note);
    expect(notes.some((note) => / ft\b/.test(note))).toBe(true);
    expect(notes.some((note) => METRIC.test(note))).toBe(false);

    const next = catalogEntry.version.version + 1;
    await db.insert(globalDiveSiteVersions).values({
      globalDiveSiteId: catalogEntry.template.id,
      version: next,
      briefing: { ...catalogEntry.version.briefing, description: "A newly expanded briefing." },
    });
    await db
      .update(globalDiveSites)
      .set({ currentVersion: next })
      .where(eq(globalDiveSites.id, catalogEntry.template.id));
    const pending = await getDiveSiteTemplateUpdate(db, shop.id, imported.id);
    expect(pending?.diff.map((change) => change.field)).toEqual(["description"]);
  });

  it("lists and previews a template as the import will land it", async () => {
    const { db, shop } = ctx;
    const catalogEntry = await templateWithMetricLandmark();
    const listed = (await listGlobalDiveSiteTemplates(db, { limit: 1000, shop })).templates.find(
      (row) => row.template.id === catalogEntry.template.id,
    );
    const preview = await getGlobalDiveSiteTemplate(db, catalogEntry.template.slug, shop);
    for (const row of [listed, preview]) {
      const notes = (row?.version.briefing.landmarks ?? []).map((landmark) => landmark.note);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.some((note) => METRIC.test(note))).toBe(false);
    }
    // Without a reader, the catalog's own words: the published version is untouched.
    const raw = await getGlobalDiveSiteTemplate(db, catalogEntry.template.slug);
    expect(raw?.version.briefing).toEqual(catalogEntry.version.briefing);
  });
});

/**
 * **A depth-unit switch follows the catalog's words** (issue #2683): a site
 * still reading exactly what the import wrote is said again in the shop's new
 * unit, and a site the shop edited is left alone and counted.
 */
describe("a depth-unit switch and imported dive-site prose", () => {
  it("converts an untouched site both ways and leaves an edited one alone", async () => {
    const { db, shop } = ctx;
    const catalog = (await listGlobalDiveSiteTemplates(db, { limit: 1000 })).templates.filter(
      (row) =>
        JSON.stringify(briefingInUnit(row.version.briefing, "feet")) !==
        JSON.stringify(briefingInUnit(row.version.briefing, "meters")),
    );
    const [first, second] = catalog;
    if (!first || !second) throw new Error("seed: two catalog sites with measures are needed");
    const untouched = await importGlobalDiveSiteTemplate(db, shop.id, first.template.id);
    const edited = await importGlobalDiveSiteTemplate(db, shop.id, second.template.id);
    if (!untouched || !edited) throw new Error("expected two catalog copies");
    await db
      .update(diveSites)
      .set({ description: `${edited.description ?? ""} Our own rope line.` })
      .where(eq(diveSites.id, edited.id));
    const notesOf = (site: { landmarks: unknown }) =>
      (site.landmarks as { note: string }[]).map((landmark) => landmark.note);
    const read = async (id: string) => {
      const [row] = await db.select().from(diveSites).where(eq(diveSites.id, id));
      if (!row) throw new Error("site missing");
      return row;
    };

    await setShopDepthUnit(db, shop.id, "meters");
    try {
      const toMeters = await convertImportedSiteProseToUnit(db, shop.id, "feet", "meters");
      expect(toMeters.converted).toBeGreaterThanOrEqual(1);
      expect(toMeters.leftAlone).toBeGreaterThanOrEqual(1);
      const inMeters = briefingInUnit(first.version.briefing, "meters");
      expect((await read(untouched.id)).description).toBe(inMeters.description ?? null);
      expect(notesOf(await read(untouched.id))).toEqual(
        (inMeters.landmarks ?? []).map((landmark) => landmark.note),
      );
      expect((await read(edited.id)).description).toBe(
        `${edited.description ?? ""} Our own rope line.`,
      );

      await setShopDepthUnit(db, shop.id, "feet");
      await convertImportedSiteProseToUnit(db, shop.id, "meters", "feet");
      const inFeet = briefingInUnit(first.version.briefing, "feet");
      expect((await read(untouched.id)).description).toBe(inFeet.description ?? null);
      expect(notesOf(await read(untouched.id))).toEqual(
        (inFeet.landmarks ?? []).map((landmark) => landmark.note),
      );
    } finally {
      await setShopDepthUnit(db, shop.id, "feet");
    }
  });

  it("does nothing when the unit did not change", async () => {
    const { db, shop } = ctx;
    expect(await convertImportedSiteProseToUnit(db, shop.id, "feet", "feet")).toEqual({
      converted: 0,
      leftAlone: 0,
    });
  });
});
