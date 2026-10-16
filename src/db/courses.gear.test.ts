import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getCourseBySlug, updateCourse } from "./courses";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/** **Rental gear is part of the course fee** (fifth-loop ideas, item 16). */
describe("a course's gear-included switch", () => {
  it("keeps a course's gear-included answer, off until the shop says so (ideas item 16)", async () => {
    const { db, shop } = ctx;
    const course = await getCourseBySlug(db, shop.id, "open-water-diver");
    if (!course) throw new Error("seeded course missing");
    expect(course.gearIncluded).toBe(false);
    const included = await updateCourse(db, shop.id, course.id, {
      priceCents: 49500,
      eLearningPriceCents: null,
      gearIncluded: true,
    });
    expect(included?.gearIncluded).toBe(true);
    // A patch that does not carry it leaves it alone.
    const repriced = await updateCourse(db, shop.id, course.id, {
      priceCents: 52500,
      eLearningPriceCents: null,
    });
    expect(repriced?.gearIncluded).toBe(true);
  });
});
