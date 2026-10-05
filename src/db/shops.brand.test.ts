import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { shops } from "./schema";
import { replaceShopfrontPhotos, setShopProfile } from "./shops";

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

/**
 * The storefront strip's save uploads between reading the list and writing it,
 * so the write only lands if the list is still what was read.
 */
describe("replacing a shop's photo strip", () => {
  it("writes when the list is unchanged, and refuses a save built on a stale read", async () => {
    const { db, shop } = await seededShopContext();
    const before = shop.shopfrontPhotoUrls;
    expect(await replaceShopfrontPhotos(db, shop.id, before, ["/a.jpg"])).toBe(true);
    // A second save that read the list before the first one landed.
    expect(await replaceShopfrontPhotos(db, shop.id, before, ["/b.jpg"])).toBe(false);
    const [row] = await db.select().from(shops).where(eq(shops.id, shop.id));
    expect(row?.shopfrontPhotoUrls).toEqual(["/a.jpg"]);
  });
});
