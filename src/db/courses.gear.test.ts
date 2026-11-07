import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { editCourse, getCourseBySlug } from "./courses";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/** **The rental kinds a course fee includes** (fifth-loop ideas, item 16; issue #2796). */
describe("a course's included rental kinds", () => {
  it("keeps the kinds the shop ticks, none until it does", async () => {
    const { db, shop } = ctx;
    const course = await getCourseBySlug(db, shop.id, "open-water-diver");
    if (!course) throw new Error("seeded course missing");
    expect(course.includedRentalKinds).toEqual([]);
    const included = await editCourse(db, shop.id, course.id, {
      priceCents: 49500,
      eLearningPriceCents: null,
      includedRentalKinds: ["wetsuit", "bcd", "regulator", "weights"],
    });
    // Stored in catalog order, whatever order the post named them in.
    expect(included?.includedRentalKinds).toEqual(["bcd", "regulator", "wetsuit", "weights"]);
    // A patch that does not carry it leaves it alone.
    const repriced = await editCourse(db, shop.id, course.id, {
      priceCents: 52500,
      eLearningPriceCents: null,
    });
    expect(repriced?.includedRentalKinds).toEqual(["bcd", "regulator", "wetsuit", "weights"]);
    const none = await editCourse(db, shop.id, course.id, {
      priceCents: 52500,
      eLearningPriceCents: null,
      includedRentalKinds: [],
    });
    expect(none?.includedRentalKinds).toEqual([]);
  });

  it("stores no nitrox fill and no unknown kind as part of a course fee", async () => {
    const { db, shop } = ctx;
    const course = await getCourseBySlug(db, shop.id, "open-water-diver");
    if (!course) throw new Error("seeded course missing");
    const included = await editCourse(db, shop.id, course.id, {
      priceCents: 49500,
      eLearningPriceCents: null,
      includedRentalKinds: ["bcd", "nitrox", "boots"] as never,
    });
    expect(included?.includedRentalKinds).toEqual(["bcd"]);
  });

  it("seeds Discover Scuba with the scuba unit, as a shop ticking the box gets it", async () => {
    const { db, shop } = ctx;
    const course = await getCourseBySlug(db, shop.id, "discover-scuba-diving");
    expect(course?.includedRentalKinds).toEqual(["bcd", "regulator", "weights"]);
  });
});
