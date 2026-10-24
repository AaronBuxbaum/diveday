import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { loadShopExportBundleInput } from "./export";
import { diveSites } from "./schema";

const ctx = fileScopedShopContext();

describe("photoUrls (ADR 20260724-export-bundled-photos)", () => {
  it("collects every image URL referenced anywhere in the bundle, deduped and sorted", async () => {
    const { db, shop } = ctx;
    const managedA = "https://diveday-media.s3.us-east-1.amazonaws.com/sites/a.jpg";
    const managedB = "https://diveday-media.s3.us-east-1.amazonaws.com/sites/b.jpg";
    // Dive-site imagery rather than certification cards: a card has carried no
    // photograph since ADR 20260811-retire-the-digital-card dropped the column,
    // so there is no card URL left for this bundle to gather. What is being
    // proved — dedup across rows, sorting, and that an unreferenced URL never
    // appears — is unchanged.
    await db.insert(diveSites).values([
      {
        shopId: shop.id,
        name: "Photo Reef One",
        slug: "photo-reef-one",
        satelliteImageUrl: managedA,
      },
      // The same URL again, on another row and another column — must be
      // deduped, not fetched or counted twice.
      { shopId: shop.id, name: "Photo Reef Two", slug: "photo-reef-two", routeImageUrl: managedA },
      // A site with no imagery at all contributes nothing (not null, not
      // undefined, not an empty string).
      { shopId: shop.id, name: "Photo Reef Three", slug: "photo-reef-three" },
    ]);

    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("shop failed to load");
    expect(input.photoUrls).toContain(managedA);
    expect(input.photoUrls.filter((url) => url === managedA)).toHaveLength(1);
    expect(input.photoUrls).not.toContain(managedB);
    expect(input.photoUrls).toEqual([...input.photoUrls].sort());
  });
});
