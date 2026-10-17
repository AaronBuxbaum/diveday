import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  getDiveSiteTemplateUpdate,
  getGlobalDiveSiteTemplate,
  importGlobalDiveSiteTemplate,
  listGlobalDiveSiteTemplates,
} from "./dive-sites";
import { globalDiveSites, globalDiveSiteVersions } from "./schema";

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
