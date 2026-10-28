import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  getDiveSiteTemplateUpdate,
  importGlobalDiveSiteTemplate,
  listDiveSiteCreatures,
  listGlobalDiveSiteTemplates,
  pullDiveSiteTemplateUpdates,
  replaceDiveSiteCreatures,
  undoDiveSiteTemplateUpdate,
} from "./dive-sites";
import { diveSites, globalDiveSites, globalDiveSiteVersions, shops } from "./schema";

const ctx = fileScopedShopContext();
describe("template effective preservation", () => {
  it.each([
    { mode: "preserve-shop-edits" as const, conservationNote: "Our conservation note" },
    { mode: "preserve-shop-edits" as const, conservationNote: "" },
    { mode: "replace-template-copy" as const, conservationNote: "Our conservation note" },
    { mode: "replace-template-copy" as const, conservationNote: "" },
  ])(
    "keeps a local conservation note through $mode and Undo",
    async ({ mode, conservationNote }) => {
      const { db, shop } = ctx;
      const entry = (await listGlobalDiveSiteTemplates(db, { limit: 1000 })).templates.find(
        (row) => row.version.briefing.name === "Molasses Reef",
      );
      if (!entry) throw new Error("seed: no Molasses Reef template");
      const site = await importGlobalDiveSiteTemplate(db, shop.id, entry.template.id);
      if (!site) throw new Error("expected catalog copy");
      await db.update(shops).set({ fieldGuideEnabled: false }).where(eq(shops.id, shop.id));
      await db
        .update(diveSites)
        .set({
          conservationNote,
          fieldGuideTipsHeading: "Our guide heading",
        })
        .where(eq(diveSites.id, site.id));
      await replaceDiveSiteCreatures(db, shop.id, site.id, ["blue-tang"]);
      const next = entry.version.version + 1;
      await db.insert(globalDiveSiteVersions).values({
        globalDiveSiteId: entry.template.id,
        version: next,
        briefing: {
          ...entry.version.briefing,
          description: "Incoming template description",
          conservationNote: "Incoming conservation note",
          fieldGuideTipsHeading: "Incoming heading",
          creatureSlugs: ["southern-stingray"],
        },
      });
      await db
        .update(globalDiveSites)
        .set({ currentVersion: next })
        .where(eq(globalDiveSites.id, entry.template.id));
      const preview = await getDiveSiteTemplateUpdate(db, shop.id, site.id);
      expect(preview?.diff.some((change) => change.field === "conservationNote")).toBe(false);
      expect((await pullDiveSiteTemplateUpdates(db, shop.id, site.id, mode)).status).toBe(
        "updated",
      );
      const [pulled] = await db.select().from(diveSites).where(eq(diveSites.id, site.id));
      expect(pulled?.conservationNote).toBe(conservationNote);
      expect(pulled?.description).toBe("Incoming template description");
      expect(pulled?.fieldGuideTipsHeading).toBe("Our guide heading");
      expect(
        (await listDiveSiteCreatures(db, shop.id, site.id)).map((row) => row.catalogSlug),
      ).toEqual(["blue-tang"]);
      expect((await undoDiveSiteTemplateUpdate(db, shop.id, site.id)).status).toBe("undone");
      const [undone] = await db.select().from(diveSites).where(eq(diveSites.id, site.id));
      expect(undone?.conservationNote).toBe(conservationNote);
      expect(undone?.description).toBe(entry.version.briefing.description ?? null);
      expect(undone?.fieldGuideTipsHeading).toBe("Our guide heading");
      expect(
        (await listDiveSiteCreatures(db, shop.id, site.id)).map((row) => row.catalogSlug),
      ).toEqual(["blue-tang"]);
      expect((await undoDiveSiteTemplateUpdate(db, shop.id, site.id)).status).toBe("unavailable");
    },
  );
});
