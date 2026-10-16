// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { diveSites } from "./schema";
import { DEMO_SHOP_BRAND, MINTED_DEMO_BRAND } from "./seed";

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
    expect(new Set(leads).size, "two sites lead with the same frame").toBe(leads.length);
  });
});
