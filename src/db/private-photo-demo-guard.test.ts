import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  clearCompletedDemoPhotoObligations,
  DEMO_PRIVATE_PHOTO_CLEANUP_REQUIRED,
} from "./private-photo-demo-guard";
import { people, privatePersonPhotoUploads } from "./schema";
import { clearDemoSchedule, deleteDemoShopCascade } from "./seed";

const ctx = fileScopedShopContext();

it.each(["staged", "active", "retired"] as const)(
  "refuses reset and reaping while a %s upload is unresolved",
  async (state) => {
    const { db, shop } = ctx;
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!person) throw new Error("seeded person missing");
    const url = `https://media.example.com/private-person-photos/${state}.jpg`;
    await db
      .insert(privatePersonPhotoUploads)
      .values({ shopId: shop.id, personId: person.id, url, state });
    await expect(clearDemoSchedule(db, shop.id)).rejects.toThrow(
      DEMO_PRIVATE_PHOTO_CLEANUP_REQUIRED,
    );
    await expect(deleteDemoShopCascade(db, shop.id)).rejects.toThrow(
      DEMO_PRIVATE_PHOTO_CLEANUP_REQUIRED,
    );
    expect(
      await db
        .select()
        .from(privatePersonPhotoUploads)
        .where(eq(privatePersonPhotoUploads.url, url)),
    ).toHaveLength(1);
    expect(await db.select().from(people).where(eq(people.id, person.id))).toHaveLength(1);
  },
);

it("clears a tombstone only after its PUT finished and the subsequent purge succeeded", async () => {
  const { db, shop } = ctx;
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!person) throw new Error("seeded person missing");
  const url = "https://media.example.com/private-person-photos/complete.jpg";
  await db.insert(privatePersonPhotoUploads).values({
    shopId: shop.id,
    personId: person.id,
    url,
    state: "retired",
    putFinished: true,
    cleanAfterPut: true,
  });
  await db.transaction((tx) => clearCompletedDemoPhotoObligations(tx, shop.id));
  expect(
    await db.select().from(privatePersonPhotoUploads).where(eq(privatePersonPhotoUploads.url, url)),
  ).toHaveLength(0);
});
