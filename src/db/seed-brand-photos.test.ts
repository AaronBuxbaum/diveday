// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { diveSites, shops } from "./schema";
import { DEMO_SHOP_BRAND, MINTED_DEMO_BRAND } from "./seed";
import { syncDemoShopBrand } from "./seed-shop-brand";

/**
 * **A minted demo shopfront never shows one picture twice** (issue #2420). The
 * logo tile, the cover and each site's lead photo are three jobs; when the
 * logo reused the Molasses Reef site's lead frame, the tile and the site card
 * were the same photo side by side, which is the repetition the cover change
 * set out to remove.
 */
describe("the demo shop's lead photos", () => {
  it("keep the minted logo, the cover and every site's first image distinct", async () => {
    const { db, shop } = await seededShopContext();
    const sites = await db
      .select({ name: diveSites.name, imageUrls: diveSites.imageUrls })
      .from(diveSites)
      .where(eq(diveSites.shopId, shop.id));
    const leads = sites.flatMap((site) => (site.imageUrls[0] ? [site.imageUrls[0]] : []));
    expect(leads.length).toBeGreaterThan(1);

    const logo = MINTED_DEMO_BRAND.logoUrl;
    const cover = MINTED_DEMO_BRAND.brandHeroImageUrl;
    expect(logo).toBeTruthy();
    expect(cover).toBe(DEMO_SHOP_BRAND.brandHeroImageUrl);
    expect(logo).not.toBe(cover);
    expect(leads).not.toContain(logo);
    expect(leads).not.toContain(cover);
    expect(MINTED_DEMO_BRAND.shopfrontPhotoUrls ?? []).not.toContain(logo);
    for (const strip of DEMO_SHOP_BRAND.shopfrontPhotoUrls) {
      expect(leads, "the photo strip repeats a site's lead photo").not.toContain(strip);
    }
    expect(new Set(leads).size, "two sites lead with the same frame").toBe(leads.length);
  });
});

/**
 * **The demo shop's profile is filled in** (Aaron, 2026-10-22), and a database
 * seeded before it was gets it from the nightly refresh, once.
 */
describe("the demo shop's profile and brand", () => {
  it("seeds a logo, an about line, a colour, a face and a photo strip", async () => {
    const { shop } = await seededShopContext();
    expect(shop.logoUrl).toBe(DEMO_SHOP_BRAND.logoUrl);
    expect(shop.description).toBeTruthy();
    expect(shop.brandColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(shop.brandDisplayFont).toBeTruthy();
    expect(shop.shopfrontPhotoUrls.length).toBeGreaterThan(4);
  });

  it("fills a blank canonical demo once and never touches a real shop", async () => {
    const { db, shop } = await seededShopContext();
    await db
      .update(shops)
      .set({ logoUrl: null, description: null, brandColor: null })
      .where(eq(shops.id, shop.id));
    const [real] = await db
      .insert(shops)
      .values({ name: "Real Shop", slug: "real-shop-brand", timezone: "UTC" })
      .returning();
    if (!real) throw new Error("shop missing");

    await syncDemoShopBrand(db);

    const [demo] = await db.select().from(shops).where(eq(shops.id, shop.id));
    expect(demo?.logoUrl).toBe(DEMO_SHOP_BRAND.logoUrl);
    expect(demo?.description).toBe(DEMO_SHOP_BRAND.description);
    expect(demo?.brandColor).toBe(DEMO_SHOP_BRAND.brandColor);
    const [after] = await db.select().from(shops).where(eq(shops.id, real.id));
    expect(after?.logoUrl).toBeNull();

    // A shop that has a logo is left as it is.
    await db.update(shops).set({ tagline: "Ours now" }).where(eq(shops.id, shop.id));
    await syncDemoShopBrand(db);
    const [kept] = await db.select().from(shops).where(eq(shops.id, shop.id));
    expect(kept?.tagline).toBe("Ours now");
  });
});
