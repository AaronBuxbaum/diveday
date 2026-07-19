// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { copyDiveSite, createDiveSite, listDiveSites } from "./dive-sites";
import { getShopBySlug } from "./queries";
import { seedDemo } from "./seed";

describe("dive-site library", () => {
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
});
