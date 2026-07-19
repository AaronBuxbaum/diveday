// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import {
  copyDiveSite,
  createDiveSite,
  deleteDiveSite,
  listDiveSites,
  updateDiveSite,
} from "./dive-sites";
import { getShopBySlug } from "./queries";
import { seedDemo } from "./seed";

describe("dive-site library", () => {
  it("keeps the full briefing and readiness gates through create and edit", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

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
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

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
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");
    const site = await createDiveSite(db, { shopId: shop.id, name: "Davis Ledge" });

    expect(
      await copyDiveSite(db, "00000000-0000-0000-0000-000000000000", site.id, "Nope"),
    ).toBeNull();
  });

  it("archives a site while keeping the briefing row intact", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");
    const site = await createDiveSite(db, { shopId: shop.id, name: "Archive Point" });

    expect(await deleteDiveSite(db, shop.id, site.id)).toBe(true);
    expect((await listDiveSites(db, shop.id)).some((entry) => entry.id === site.id)).toBe(false);
    expect(await copyDiveSite(db, shop.id, site.id, "Should not copy")).toBeNull();
  });
});
