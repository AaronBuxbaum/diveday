import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { shops } from "./schema";
import { setShopProfile } from "./shops";

/**
 * The brand columns (Harbor, ADR 20260901-diveday-reimagined, decision 2) and
 * the two constraints that keep a storefront from printing nonsense: a colour
 * is `#rrggbb` lowercase or nothing, and an opening year is one a shop could
 * plausibly have opened in.
 */
describe("a shop's brand", () => {
  it("stores the whole brand, and blanks clear it", async () => {
    const { db, shop } = await seededShopContext();
    const shopId = shop.id;
    const saved = await setShopProfile(db, shopId, {
      brandColor: "#178f6a",
      brandDisplayFont: "outfit",
      brandHeroImageUrl: "https://blob.example/hero.jpg",
      brandHeroImageAlt: "The boat at the mooring",
      establishedYear: 1998,
      brandBadges: ["blue_star", "padi_5_star"],
    });
    expect(saved?.brandColor).toBe("#178f6a");
    expect(saved?.brandDisplayFont).toBe("outfit");
    expect(saved?.establishedYear).toBe(1998);
    // The shop's order, not the catalogue's.
    expect(saved?.brandBadges).toEqual(["blue_star", "padi_5_star"]);

    const cleared = await setShopProfile(db, shopId, {
      brandColor: "",
      brandDisplayFont: null,
      brandHeroImageUrl: "",
      brandHeroImageAlt: "",
      establishedYear: null,
      brandBadges: [],
    });
    expect(cleared?.brandColor).toBeNull();
    expect(cleared?.brandDisplayFont).toBeNull();
    expect(cleared?.brandHeroImageUrl).toBeNull();
    expect(cleared?.establishedYear).toBeNull();
    expect(cleared?.brandBadges).toEqual([]);
  });

  it("refuses a colour that is not #rrggbb lowercase", async () => {
    const { db, shop } = await seededShopContext();
    const shopId = shop.id;
    await expect(
      db.update(shops).set({ brandColor: "#178F6A" }).where(eq(shops.id, shopId)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    await expect(
      db.update(shops).set({ brandColor: "teal" }).where(eq(shops.id, shopId)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });

  it("refuses an implausible opening year", async () => {
    const { db, shop } = await seededShopContext();
    const shopId = shop.id;
    await expect(
      db.update(shops).set({ establishedYear: 1850 }).where(eq(shops.id, shopId)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
  });
});
