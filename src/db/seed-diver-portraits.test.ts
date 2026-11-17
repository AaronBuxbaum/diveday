import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { people, shops } from "./schema";
import { DEMO_DIVER_PORTRAITS, seedDiverPortraits } from "./seed-diver-portraits";

it("seeds distinct bundled portraits for only part of the demo cast", async () => {
  const { db, shop } = await seededShopContext();
  const rows = await db.select().from(people).where(eq(people.shopId, shop.id));
  for (const [name, path] of Object.entries(DEMO_DIVER_PORTRAITS)) {
    expect(existsSync(`public${path}`)).toBe(true);
    expect(rows.find((row) => row.fullName === name)?.staffPhotoPath).toBe(path);
  }
  expect(new Set(Object.values(DEMO_DIVER_PORTRAITS)).size).toBe(4);
  expect(rows.find((row) => row.fullName === "Lena Fischer")?.staffPhotoPath).toBeNull();
  expect(rows.find((row) => row.fullName === "Diego Alvarez")?.staffPhotoPath).toBeNull();
});

it("never writes to another shop or replaces a selected photo", async () => {
  const { db, shop } = await seededShopContext();
  const [priya] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Priya Sharma")));
  await db.update(people).set({ staffPhotoPath: "/own.webp" }).where(eq(people.id, priya.id));
  await seedDiverPortraits(db, shop.id, [priya]);
  expect((await db.select().from(people).where(eq(people.id, priya.id)))[0].staffPhotoPath).toBe(
    "/own.webp",
  );
  await db.update(people).set({ staffPhotoPath: null }).where(eq(people.id, priya.id));
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  await seedDiverPortraits(db, shop.id, [priya]);
  expect(
    (await db.select().from(people).where(eq(people.id, priya.id)))[0].staffPhotoPath,
  ).toBeNull();
});
