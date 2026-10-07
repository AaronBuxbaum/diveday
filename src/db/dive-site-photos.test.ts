import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import { diveSitePhotosNoOtherSiteHolds, diveSitePhotoUrlsHeldByShop } from "./dive-site-photos";
import { diveSites, shops } from "./schema";

const MEDIA = "https://media.example.com";

async function twoShops() {
  const db = await unseededTestDb();
  const [mine, theirs] = await db
    .insert(shops)
    .values([
      { name: "Mine", slug: "mine-photos", timezone: "America/New_York" },
      { name: "Theirs", slug: "theirs-photos", timezone: "America/New_York" },
    ])
    .returning();
  if (!mine || !theirs) throw new Error("shop insert failed");
  return { db, mine, theirs };
}

describe("dive-site photo holders (issue #2078)", () => {
  /**
   * **A save that lets go of a photo deletes the object only when no other
   * site still shows it.** Another shop's site naming the same stored URL (an
   * import before #2078 could write one), or this shop's own copy of the site,
   * keeps the object alive; deleting it would break their picture with the
   * failure filed under this shop.
   */
  it("keeps back every photo another site still holds, in any column, in any shop", async () => {
    const { db, mine, theirs } = await twoShops();
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine" })
      .returning();
    if (!site) throw new Error("site insert failed");
    await db.insert(diveSites).values([
      { shopId: theirs.id, name: "A", slug: "a", satelliteImageUrl: `${MEDIA}/sat.jpg` },
      { shopId: theirs.id, name: "B", slug: "b", routeImageUrl: `${MEDIA}/route.jpg` },
      { shopId: theirs.id, name: "C", slug: "c", imageUrls: [`${MEDIA}/gallery.jpg`] },
      {
        shopId: mine.id,
        name: "Copy",
        slug: "copy",
        landmarks: [
          { name: "Arch", kind: "pointOfInterest", note: "", photoUrl: `${MEDIA}/arch.jpg` },
        ],
      },
    ]);

    const free = await diveSitePhotosNoOtherSiteHolds(db, site.id, [
      `${MEDIA}/sat.jpg`,
      `${MEDIA}/route.jpg`,
      `${MEDIA}/gallery.jpg`,
      `${MEDIA}/arch.jpg`,
      `${MEDIA}/only-mine.jpg`,
    ]);
    expect(free).toEqual([`${MEDIA}/only-mine.jpg`]);
  });

  it("frees a photo only this site held, and asks nothing for no photos", async () => {
    const { db, mine } = await twoShops();
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine", imageUrls: [`${MEDIA}/x.jpg`] })
      .returning();
    if (!site) throw new Error("site insert failed");
    expect(await diveSitePhotosNoOtherSiteHolds(db, site.id, [`${MEDIA}/x.jpg`])).toEqual([
      `${MEDIA}/x.jpg`,
    ]);
    expect(await diveSitePhotosNoOtherSiteHolds(db, site.id, [])).toEqual([]);
  });

  it("reads the photos a shop holds and none another shop holds", async () => {
    const { db, mine, theirs } = await twoShops();
    await db.insert(diveSites).values([
      { shopId: mine.id, name: "Mine", slug: "mine", imageUrls: [`${MEDIA}/mine.jpg`] },
      { shopId: theirs.id, name: "Theirs", slug: "theirs", imageUrls: [`${MEDIA}/theirs.jpg`] },
    ]);
    const held = await diveSitePhotoUrlsHeldByShop(db, mine.id);
    expect([...held]).toEqual([`${MEDIA}/mine.jpg`]);
  });
});
