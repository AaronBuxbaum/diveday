import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { diveSites, gearItems, gearServiceEvents, shops } from "@/db/schema";
import { prepareGearImport } from "@/features/gear/gear-import";
import { prepareDiveSiteImport } from "@/features/sites/dive-sites";
import { fileScopedShopContext } from "@/test/db";
import { previewDiveSiteImport, previewGearImport } from "./file-review";

const ctx = fileScopedShopContext();

describe("existing import advisory tenant matches", () => {
  it("detects repeated service records without treating them as permission to replace evidence", async () => {
    const { db, shop } = ctx;
    const [item] = await db
      .insert(gearItems)
      .values({ shopId: shop.id, label: "PREVIEW-TANK", kind: "tank" })
      .returning();
    await db
      .insert(gearServiceEvents)
      .values({ shopId: shop.id, gearItemId: item.id, kind: "service", servicedOn: "2026-01-01" });
    const prepared = prepareGearImport(
      "gear_label,serviced_on\nPREVIEW-TANK,2026-01-01\nNEW-PREVIEW,2026-02-01\nNEW-PREVIEW,2026-02-01\nBROKEN,no-date",
    );
    expect((await previewGearImport(db, shop.id, prepared)).map((row) => row.outcome)).toEqual([
      "duplicate",
      "create",
      "duplicate",
      "skip",
    ]);
    expect(
      await db.select().from(gearServiceEvents).where(eq(gearServiceEvents.gearItemId, item.id)),
    ).toHaveLength(1);
  });
  it("does not match another shop’s site or equipment", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ slug: "preview-other-shop", name: "Other", timezone: "UTC" })
      .returning();
    await db.insert(gearItems).values({ shopId: other.id, label: "FOREIGN-GEAR", kind: "tank" });
    const [site] = await db
      .insert(diveSites)
      .values({ shopId: other.id, name: "Foreign Reef", slug: "foreign-reef" })
      .returning();
    expect(
      (await previewGearImport(db, shop.id, prepareGearImport("gear_label\nFOREIGN-GEAR")))[0]
        .outcome,
    ).toBe("create");
    expect(
      (
        await previewDiveSiteImport(
          db,
          shop.id,
          prepareDiveSiteImport(`id,name\n${site.id},Foreign Reef\n${site.id},Foreign Reef`),
        )
      ).map((row) => row.outcome),
    ).toEqual(["create", "duplicate"]);
  });
});

it("previews a same-file equipment match without pretending a second unit will be created", async () => {
  const { db, shop } = ctx;
  const prepared = prepareGearImport(
    "gear_label,serial_number\nFILE-UNIT-A,FILE-SERIAL-A\nFILE-UNIT-A,FILE-SERIAL-A\nFILE-UNIT-RENAMED,FILE-SERIAL-A",
  );
  expect((await previewGearImport(db, shop.id, prepared)).map((row) => row.outcome)).toEqual([
    "create",
    "update",
    "update",
  ]);
});
