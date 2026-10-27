import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  getDiveSiteTemplateUpdate,
  importGlobalDiveSiteTemplate,
  listGlobalDiveSiteTemplates,
  pullDiveSiteTemplateUpdates,
  undoDiveSiteTemplateUpdate,
} from "./dive-sites";
import { diveSites, globalDiveSites, globalDiveSiteVersions, shops } from "./schema";

const ctx = fileScopedShopContext();
describe("template effective preservation", () => {
  it("keeps conservation text and guide-off headings through replacement and Undo, as the preview promises", async () => {
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
        conservationNote: "Our conservation note",
        fieldGuideTipsHeading: "Our guide heading",
      })
      .where(eq(diveSites.id, site.id));
    const next = entry.version.version + 1;
    await db.insert(globalDiveSiteVersions).values({
      globalDiveSiteId: entry.template.id,
      version: next,
      briefing: {
        ...entry.version.briefing,
        conservationNote: "Incoming conservation note",
        fieldGuideTipsHeading: "Incoming heading",
      },
    });
    await db
      .update(globalDiveSites)
      .set({ currentVersion: next })
      .where(eq(globalDiveSites.id, entry.template.id));
    const preview = await getDiveSiteTemplateUpdate(db, shop.id, site.id);
    expect(preview?.diff.find((change) => change.field === "conservationNote")?.latest).toBe(
      "Incoming conservation note",
    );
    expect(
      (await pullDiveSiteTemplateUpdates(db, shop.id, site.id, "replace-template-copy")).status,
    ).toBe("updated");
    const [pulled] = await db.select().from(diveSites).where(eq(diveSites.id, site.id));
    expect(pulled?.conservationNote).toBe("Our conservation note");
    expect(pulled?.fieldGuideTipsHeading).toBe("Our guide heading");
    expect((await undoDiveSiteTemplateUpdate(db, shop.id, site.id)).status).toBe("undone");
    const [undone] = await db.select().from(diveSites).where(eq(diveSites.id, site.id));
    expect(undone?.conservationNote).toBe("Our conservation note");
    expect(undone?.fieldGuideTipsHeading).toBe("Our guide heading");
  });
});
