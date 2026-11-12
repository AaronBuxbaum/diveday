import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { shops } from "./schema";
import { syncDemoShopPackingCopy } from "./seed-shop-brand";

const ctx = fileScopedShopContext();
const oldList = [
  "Custom towel",
  "Your certification card and logbook",
  "Seasickness tablets, taken the night before",
];
const oldNotes =
  "Our own dock notes. Seasick divers should take medicine the night before. Keep this.";
it("corrects only the known seeded packing phrases on the canonical demo and keeps custom words and flags", async () => {
  const { db, shop } = ctx;
  await db
    .update(shops)
    .set({ packingList: oldList, replyNotes: oldNotes, packingLogbook: false })
    .where(eq(shops.id, shop.id));
  await syncDemoShopPackingCopy(db);
  const [updated] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(updated.packingList).toEqual(["Custom towel", "Seasickness supplies, if you use them"]);
  expect(updated.replyNotes).toBe("Our own dock notes. Keep this.");
  expect(updated.packingLogbook).toBe(false);
  await syncDemoShopPackingCopy(db);
  const [again] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(again).toEqual(updated);
});
it("leaves real shops and other demo shops alone", async () => {
  const { db, shop } = ctx;
  await db
    .update(shops)
    .set({ isDemo: false, packingList: oldList, replyNotes: oldNotes })
    .where(eq(shops.id, shop.id));
  const [other] = await db
    .insert(shops)
    .values({
      name: "Other demo",
      slug: "other-packing-demo",
      timezone: "UTC",
      isDemo: true,
      packingList: oldList,
      replyNotes: oldNotes,
    })
    .returning();
  await syncDemoShopPackingCopy(db);
  for (const id of [shop.id, other.id]) {
    const [kept] = await db.select().from(shops).where(eq(shops.id, id));
    expect(kept.packingList).toEqual(oldList);
    expect(kept.replyNotes).toBe(oldNotes);
  }
});
