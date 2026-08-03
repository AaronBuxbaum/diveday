import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  copyDiveSite,
  createDiveSite,
  deleteDiveSite,
  importGlobalDiveSiteTemplate,
  listDiveSites,
  listGlobalDiveSiteTemplates,
  updateDiveSite,
} from "./dive-sites";

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
    const [catalogEntry] = await listGlobalDiveSiteTemplates(db);
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
