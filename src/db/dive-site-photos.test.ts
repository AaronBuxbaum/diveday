import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import {
  diveSitePhotosNoOtherSiteHolds,
  diveSitePhotoUrlsHeldByShop,
  ownedDiveSitePhotos,
} from "./dive-site-photos";
import { DIVE_SITE_TEMPLATES } from "./dive-site-templates";
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

/** Both steps back to back, for the tests about who counts as a holder. */
async function release(
  db: Awaited<ReturnType<typeof unseededTestDb>>,
  shopId: string,
  siteId: string,
  urls: readonly string[],
) {
  return diveSitePhotosNoOtherSiteHolds(db, siteId, await ownedDiveSitePhotos(db, shopId, urls));
}

describe("dive-site photo holders (issue #2078)", () => {
  /**
   * **Holders are read after the save, not before** (security review). Step
   * one runs while the site still holds the photo; a copy of the site made in
   * the same shop between that read and the save's write must still count, or
   * the copy's picture is deleted under it.
   */
  it("keeps a photo a copy picked up between choosing candidates and the save", async () => {
    const { db, mine } = await twoShops();
    const url = `${MEDIA}/copied.jpg`;
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine", imageUrls: [url] })
      .returning();
    if (!site) throw new Error("site insert failed");

    const owned = await ownedDiveSitePhotos(db, mine.id, [url]);
    // A concurrent copy, then the save that takes the photo off the original.
    await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Copy", slug: "copy", imageUrls: [url] });
    await db.update(diveSites).set({ imageUrls: [] }).where(eq(diveSites.id, site.id));

    expect(await diveSitePhotosNoOtherSiteHolds(db, site.id, owned)).toEqual([]);
  });

  it("frees a photo after the save once nothing else holds it", async () => {
    const { db, mine } = await twoShops();
    const url = `${MEDIA}/gone.jpg`;
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine", imageUrls: [url] })
      .returning();
    if (!site) throw new Error("site insert failed");
    const owned = await ownedDiveSitePhotos(db, mine.id, [url]);
    await db.update(diveSites).set({ imageUrls: [] }).where(eq(diveSites.id, site.id));
    expect(await diveSitePhotosNoOtherSiteHolds(db, site.id, owned)).toEqual([url]);
  });

  /**
   * **A save that lets go of a photo deletes the object only when no other
   * site still shows it.** Another shop's site naming the same stored URL (an
   * import before #2078 could write one), or this shop's own copy of the site,
   * keeps the object alive; deleting it would break their picture with the
   * failure filed under this shop. Asked before the save writes, while the
   * site still holds every one of them.
   */
  it("keeps back every photo another site still holds, in any column, in any shop", async () => {
    const { db, mine, theirs } = await twoShops();
    const held = [
      `${MEDIA}/sat.jpg`,
      `${MEDIA}/route.jpg`,
      `${MEDIA}/gallery.jpg`,
      `${MEDIA}/arch.jpg`,
      `${MEDIA}/only-mine.jpg`,
    ];
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine", imageUrls: held })
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

    expect(await release(db, mine.id, site.id, held)).toEqual([`${MEDIA}/only-mine.jpg`]);
  });

  /**
   * **A caller can only ask about photos its own shop holds.** A URL this shop
   * has never held is dropped before any other shop's rows are read, so the
   * answer cannot say whether some other shop holds it.
   */
  it("never answers for a photo this shop does not hold", async () => {
    const { db, mine, theirs } = await twoShops();
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine" })
      .returning();
    if (!site) throw new Error("site insert failed");
    await db
      .insert(diveSites)
      .values({ shopId: theirs.id, name: "T", slug: "t", imageUrls: [`${MEDIA}/theirs.jpg`] });

    expect(
      await release(db, mine.id, site.id, [`${MEDIA}/theirs.jpg`, `${MEDIA}/nobodys.jpg`]),
    ).toEqual([]);
  });

  it("frees a photo only this site held, and asks nothing for no photos", async () => {
    const { db, mine } = await twoShops();
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine", imageUrls: [`${MEDIA}/x.jpg`] })
      .returning();
    if (!site) throw new Error("site insert failed");
    expect(await release(db, mine.id, site.id, [`${MEDIA}/x.jpg`])).toEqual([`${MEDIA}/x.jpg`]);
    expect(await release(db, mine.id, site.id, [])).toEqual([]);
  });

  it("is not failed by a row whose landmarks are not an array", async () => {
    const { db, mine, theirs } = await twoShops();
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: mine.id, name: "Mine", slug: "mine", imageUrls: [`${MEDIA}/x.jpg`] })
      .returning();
    if (!site) throw new Error("site insert failed");
    const [odd] = await db
      .insert(diveSites)
      .values({ shopId: theirs.id, name: "Odd", slug: "odd" })
      .returning();
    if (!odd) throw new Error("site insert failed");
    await db.execute(
      sql`update dive_sites set landmarks = '{"photoUrl": "x"}'::jsonb where id = ${odd.id}`,
    );

    expect(await release(db, mine.id, site.id, [`${MEDIA}/x.jpg`])).toEqual([`${MEDIA}/x.jpg`]);
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

  /**
   * **The catalog is not a holder, because it can only name bundled files.**
   * `diveSitePhotosNoOtherSiteHolds` does not read `global_dive_site_versions`;
   * that is safe only while every template photo is a root-relative path to a
   * file in `public/`, which storage never deletes. A template naming a stored
   * URL turns this red.
   */
  it("keeps every catalog briefing photo a bundled file under public/", () => {
    const publicDir = join(process.cwd(), "public");
    const photos = DIVE_SITE_TEMPLATES.flatMap(({ slug, briefing }) =>
      [
        briefing.satelliteImageUrl,
        briefing.routeImageUrl,
        ...(briefing.imageUrls ?? []),
        ...(briefing.landmarks ?? []).map((landmark) => landmark.photoUrl),
      ]
        .filter((url): url is string => Boolean(url))
        .map((url) => ({ slug, url })),
    );
    const failures = photos.filter(
      ({ url }) =>
        !url.startsWith("/") ||
        url.startsWith("//") ||
        !existsSync(join(publicDir, decodeURIComponent(url))),
    );
    expect(failures).toEqual([]);
  });
});
