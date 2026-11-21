import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { staffDefs } from "./cast";

const DEMO_STAFF_PORTRAITS = JSON.parse(
  readFileSync("docs/design/staff-portraits.json", "utf8"),
) as Record<string, { url: string; alt: string } | null>;

describe("fictional demo staff portrait assets", () => {
  it("accounts for every stable cast key without identifying people by name", () => {
    expect(Object.keys(DEMO_STAFF_PORTRAITS).sort()).toEqual(
      staffDefs.map((staff) => staff.local).sort(),
    );
    expect(DEMO_STAFF_PORTRAITS.sal?.url).toContain("sal-moretti.webp");
  });

  it("provides distinct bundled portraits with exact prompt records", () => {
    const doc = readFileSync("docs/design/staff-portraits.md", "utf8");
    const urls = new Set<string>();
    for (const portrait of Object.values(DEMO_STAFF_PORTRAITS)) {
      if (!portrait) continue;
      expect(portrait.alt).toMatch(/^Generated demo portrait of fictional /);
      expect(existsSync(path.join("public", portrait.url))).toBe(true);
      expect(doc).toContain(`public${portrait.url}`);
      expect(urls.has(portrait.url)).toBe(false);
      urls.add(portrait.url);
    }
    expect(urls.size).toBe(6);
  });
});

it("persists a unique staff photo for each demo cast member without changing public consent", async () => {
  const { seededShopContext } = await import("@/test/db");
  const { listStaff } = await import("../trips");
  const { db, shop } = await seededShopContext();
  const staff = await listStaff(db, shop.id);
  const paths = staff.map((row) => row.person.staffPhotoPath);
  expect(paths).toHaveLength(6);
  expect(new Set(paths).size).toBe(6);
  expect(paths.every((path) => path?.startsWith("/demo-staff/") && path.endsWith(".webp"))).toBe(
    true,
  );
  expect(staff.filter((row) => row.person.crewPublicConsentAt)).toHaveLength(2);
});

it("gives every seeded sign-in account a portrait in canonical and newly minted demos", async () => {
  const { seededShopContext } = await import("@/test/db");
  const { eq } = await import("drizzle-orm");
  const { people, shops, userAccounts } = await import("../schema");
  const { createDemoShop } = await import(".");
  const { db, shop } = await seededShopContext();
  const minted = await createDemoShop(db, { shape: "lean" });
  const [mintedShop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.slug, minted.slug));
  if (!mintedShop) throw new Error("minted demo shop missing");
  for (const [shopId, count] of [
    [shop.id, 4],
    [mintedShop.id, 6],
  ] as const) {
    const accounts = await db
      .select({ photo: people.staffPhotoPath })
      .from(userAccounts)
      .innerJoin(people, eq(userAccounts.personId, people.id))
      .where(eq(people.shopId, shopId));
    expect(accounts).toHaveLength(count);
    expect(accounts.every(({ photo }) => photo?.startsWith("/demo-staff/"))).toBe(true);
    expect(new Set(accounts.map(({ photo }) => photo)).size).toBe(count);
  }
});

it("does not assign demo photos in a real shop", async () => {
  const { seededShopContext } = await import("@/test/db");
  const { eq } = await import("drizzle-orm");
  const { people, shops } = await import("../schema");
  const { seedStaffPortraits } = await import("./staff-portraits");
  const { db, shop } = await seededShopContext();
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
  await db.update(people).set({ staffPhotoPath: null }).where(eq(people.shopId, shop.id));
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id));
  await seedStaffPortraits(db, shop.id, [{ id: person.id, local: "dana" }]);
  const rows = await db
    .select({ path: people.staffPhotoPath })
    .from(people)
    .where(eq(people.shopId, shop.id));
  expect(rows.every((row) => row.path === null)).toBe(true);
});

it("addresses seeded IDs across renames without assigning a namesake's portrait", async () => {
  const { seededShopContext } = await import("@/test/db");
  const { and, eq } = await import("drizzle-orm");
  const { people } = await import("../schema");
  const { seedStaffPortraits, DEMO_STAFF_PORTRAIT_PATHS } = await import("./staff-portraits");
  const { db, shop } = await seededShopContext();
  const [castPerson] = await db
    .select()
    .from(people)
    .where(
      and(eq(people.shopId, shop.id), eq(people.staffPhotoPath, DEMO_STAFF_PORTRAIT_PATHS.dana)),
    );
  await db
    .update(people)
    .set({ fullName: "Renamed staff member", staffPhotoPath: null })
    .where(eq(people.id, castPerson.id));
  const [namesake] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: castPerson.fullName })
    .returning();
  await seedStaffPortraits(db, shop.id, [{ id: castPerson.id, local: "dana" }]);
  const [renamed] = await db.select().from(people).where(eq(people.id, castPerson.id));
  const [unrelated] = await db.select().from(people).where(eq(people.id, namesake.id));
  expect(renamed.staffPhotoPath).toBe(DEMO_STAFF_PORTRAIT_PATHS.dana);
  expect(unrelated.staffPhotoPath).toBeNull();
});

it("preserves a photo already chosen for a demo cast member", async () => {
  const { seededShopContext } = await import("@/test/db");
  const { eq } = await import("drizzle-orm");
  const { people } = await import("../schema");
  const { listStaff } = await import("../trips");
  const { seedStaffPortraits } = await import("./staff-portraits");
  const { db, shop } = await seededShopContext();
  const person = (await listStaff(db, shop.id))[0].person;
  await db
    .update(people)
    .set({ staffPhotoPath: "/own-photo.webp" })
    .where(eq(people.id, person.id));
  await seedStaffPortraits(db, shop.id, [{ id: person.id, local: "dana" }]);
  const [after] = await db.select().from(people).where(eq(people.id, person.id));
  expect(after.staffPhotoPath).toBe("/own-photo.webp");
});
