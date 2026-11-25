import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { listPublicStaffProfiles } from "@/features/public-site/public-staff-profiles";
import { readShopPick } from "@/features/public-site/shop-pick";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { courses, people, shops } from "../schema";
import { resetDemoSchedule } from "./index";
import { DEMO_SHOP_BRAND, syncDemoShopWelcome } from "./shop-brand";

// #4928: the demo shows the features that put a person in front of a diver who has not booked.

it("signs the welcome, posts one notice and features the first-timer course", async () => {
  const { db, shop } = await seededShopContext();
  const [row] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(row.welcomeText).toBe(DEMO_SHOP_BRAND.welcomeText);
  expect(row.welcomeSigner).toBe("Dana Reyes, owner");
  expect(row.noticeText).toBe(DEMO_SHOP_BRAND.noticeText);
  // The public departure record stays off: the demo seeds not-ready divers on purpose, and its
  // counts would read as a poor record to a diver who has not booked.
  expect(row.safetyRecordEnabled).toBe(false);
  const pick = await readShopPick(db, row, nowDate());
  expect(pick?.kind).toBe("course");
  if (pick?.kind === "course") {
    expect(pick.course.title).toBe("Discover Scuba Diving");
    expect(pick.starts.length).toBeGreaterThan(0);
  }
});

it("keeps the pick on a course that exists after a reset gives every course a new id", async () => {
  const { db, shop } = await seededShopContext();
  const [before] = await db.select().from(shops).where(eq(shops.id, shop.id));
  await resetDemoSchedule(db, shop.id, "lean");
  const [after] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(after.pickCourseId).not.toBe(before.pickCourseId);
  const [course] = await db
    .select({ title: courses.title })
    .from(courses)
    .where(and(eq(courses.shopId, shop.id), eq(courses.id, after.pickCourseId ?? "")));
  expect(course?.title).toBe("Discover Scuba Diving");
});

it("leaves a welcome the owner already wrote alone", async () => {
  const { db, shop } = await seededShopContext();
  await db.update(shops).set({ welcomeText: "Our own words." }).where(eq(shops.id, shop.id));
  await syncDemoShopWelcome(db);
  const [row] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(row.welcomeText).toBe("Our own words.");
});

it("publishes crew profiles for most of the crew and leaves one without", async () => {
  const { db, shop } = await seededShopContext();
  const rows = await db
    .select({
      fullName: people.fullName,
      enabled: people.publicStaffProfileEnabled,
      profile: people.publicStaffProfile,
    })
    .from(people)
    .where(eq(people.shopId, shop.id));
  const byName = new Map(rows.map((row) => [row.fullName, row]));
  for (const name of ["Dana Reyes", "Marcus Webb", "Keiko Tanaka", "Sal Moretti"]) {
    expect(byName.get(name)?.enabled, name).toBe(true);
    expect(byName.get(name)?.profile?.photoUrls[0]).toMatch(/^\/demo-staff\//);
  }
  expect(byName.get("Yusra Idrissi")?.enabled).toBe(false);
  expect(byName.get("Yusra Idrissi")?.profile).toBeNull();
  // The storefront lists the people with a sign-in; the one without a profile is not among them.
  const shown = await listPublicStaffProfiles(db, shop.id);
  expect(shown.map((profile) => profile.firstName)).toEqual(["Dana", "Keiko", "Marcus", "Sal"]);
});
