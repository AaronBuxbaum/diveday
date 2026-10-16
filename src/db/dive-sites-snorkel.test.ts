import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createDiveSite, updateDiveSite } from "./dive-sites";

const ctx = fileScopedShopContext();

describe("snorkel-suitable dive sites (#2214)", () => {
  // Issue #2214: the flag is a three-way answer, and "not said" must survive
  // a save as null rather than collapsing to no.
  it("keeps a site's snorkel answer, including not said, through create and edit", async () => {
    const { db, shop } = ctx;
    const site = await createDiveSite(db, {
      shopId: shop.id,
      name: "Snorkel Garden",
      snorkelSuitable: true,
    });
    expect(site.snorkelSuitable).toBe(true);

    const no = await updateDiveSite(db, shop.id, site.id, {
      shopId: shop.id,
      name: site.name,
      snorkelSuitable: false,
    });
    expect(no).toMatchObject({ snorkelSuitable: false });

    const unsaid = await updateDiveSite(db, shop.id, site.id, {
      shopId: shop.id,
      name: site.name,
      snorkelSuitable: null,
    });
    expect(unsaid).toMatchObject({ snorkelSuitable: null });

    const plain = await createDiveSite(db, { shopId: shop.id, name: "Unrated Wall" });
    expect(plain.snorkelSuitable).toBeNull();
  });
});
