import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { people, shops } from "../schema";
import { customerDefs } from "./cast";
import { DEMO_DIVER_PORTRAITS, seedDiverPortraits } from "./diver-portraits";

it("seeds distinct bundled portraits for only part of the demo cast", async () => {
  const { db, shop } = await seededShopContext();
  const rows = await db.select().from(people).where(eq(people.shopId, shop.id));
  const hashes = new Set<string>();
  for (const [name, path] of Object.entries(DEMO_DIVER_PORTRAITS)) {
    const bytes = readFileSync(`public${path}`);
    hashes.add(createHash("sha256").update(bytes).digest("hex"));
    expect(rows.find((row) => row.fullName === name)?.staffPhotoPath).toBe(path);
  }
  expect(new Set(Object.values(DEMO_DIVER_PORTRAITS)).size).toBe(70);
  expect(hashes.size).toBe(70);
  expect(customerDefs.filter(({ fullName }) => !DEMO_DIVER_PORTRAITS[fullName])).toHaveLength(13);
  expect(rows.find((row) => row.fullName === "Lena Fischer")?.staffPhotoPath).toBeNull();
  expect(rows.find((row) => row.fullName === "Sam Whitfield")?.staffPhotoPath).toBeNull();
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
  const [otherShop] = await db
    .insert(shops)
    .values({ name: "Other demo", slug: "other-portrait-demo", timezone: "UTC", isDemo: true })
    .returning();
  await seedDiverPortraits(db, otherShop.id, [priya]);
  expect(
    (await db.select().from(people).where(eq(people.id, priya.id)))[0].staffPhotoPath,
  ).toBeNull();
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  await seedDiverPortraits(db, shop.id, [priya]);
  expect(
    (await db.select().from(people).where(eq(people.id, priya.id)))[0].staffPhotoPath,
  ).toBeNull();
});
