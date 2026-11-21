import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { listActiveCourses, listShelfCourses, SHELF_COURSE_COUNT } from "./store";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * The storefront's course shelf reads only what its cards draw (performance
 * audit 2026-11-11, item 6), and must show exactly what the whole-row read
 * showed: the same three courses, in the same order, with the same values.
 */
describe("listShelfCourses", () => {
  it("reads the first three active courses, with the same values as the full read", async () => {
    const { db, shop } = ctx;
    const shelf = await listShelfCourses(db, shop.id);
    const active = (await listActiveCourses(db, shop.id)).slice(0, SHELF_COURSE_COUNT);
    expect(active).toHaveLength(SHELF_COURSE_COUNT);
    expect(shelf).toEqual(
      active.map((course) => ({
        id: course.id,
        slug: course.slug,
        title: course.title,
        summary: course.summary,
        durationText: course.durationText,
        heroImageUrl: course.heroImageUrl,
        heroImageAlt: course.heroImageAlt,
        priceCents: course.priceCents,
        eLearningPriceCents: course.eLearningPriceCents,
      })),
    );
  });
});
