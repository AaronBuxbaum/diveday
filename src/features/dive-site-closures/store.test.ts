import { describe, expect, it } from "vitest";
import { createDiveSite, getDiveSite, listDiveSitesForSitemap } from "../../db/dive-sites";
import { fileScopedShopContext } from "../../test/db";
import { recordDiveSiteClosure } from "./store";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * Loop 5, row 5: a site closed this month is one window and a reason. The
 * public page hides it while the window covers the shop's today, and the
 * sitemap leaves it out; the staff library keeps it.
 */
describe("a dive site's closure window", () => {
  it("records a window and its reason, and clears it again", async () => {
    const { db, shop } = ctx;
    const site = await createDiveSite(db, { shopId: shop.id, name: "Closing Reef" });
    expect(
      await recordDiveSiteClosure(db, {
        shopId: shop.id,
        siteId: site.id,
        window: { from: "2026-11-10", until: "2026-11-20", reason: "Mooring buoys out" },
      }),
    ).toBe(true);
    expect(await getDiveSite(db, shop.id, site.id)).toMatchObject({
      closedFrom: "2026-11-10",
      closedUntil: "2026-11-20",
      closureReason: "Mooring buoys out",
    });
    await recordDiveSiteClosure(db, { shopId: shop.id, siteId: site.id, window: null });
    expect(await getDiveSite(db, shop.id, site.id)).toMatchObject({
      closedFrom: null,
      closedUntil: null,
      closureReason: null,
    });
  });

  it("reaches nothing in another shop", async () => {
    const { db, shop } = ctx;
    const site = await createDiveSite(db, { shopId: shop.id, name: "Tenant Reef" });
    expect(
      await recordDiveSiteClosure(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        siteId: site.id,
        window: { from: "2026-11-10", until: "2026-11-20", reason: null },
      }),
    ).toBe(false);
    expect((await getDiveSite(db, shop.id, site.id))?.closedFrom).toBeNull();
  });

  it("leaves a site closed today out of the sitemap", async () => {
    const { db, shop } = ctx;
    const site = await createDiveSite(db, { shopId: shop.id, name: "Sitemap Closed Reef" });
    await recordDiveSiteClosure(db, {
      shopId: shop.id,
      siteId: site.id,
      window: { from: "2000-01-01", until: "2999-12-31", reason: null },
    });
    const listed = await listDiveSitesForSitemap(db);
    expect(listed.some((row) => row.siteSlug === site.slug && row.shopSlug === shop.slug)).toBe(
      false,
    );
  });
});
