import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop, shopCounterLock } from "@/test/postgres-shop";
import type { AppDb } from "./client";
import { attachStandardCourseForms } from "./course-forms";
import { courseFormVersions, courses } from "./schema";

/**
 * Two courses synced at once in one shop (fourth review, rows 16 and 33).
 *
 * Each caller has just inserted its course, so it already holds the `KEY SHARE`
 * that insert's foreign key takes on the shop row, and then
 * `attachStandardCourseForms` locks that row to create the standard forms by
 * title. Taken `for update`, as it was until 2026-10-13, the two upgrades wait
 * on each other's key share and Postgres kills one (`40P01`). Taken `for no
 * key update`, they serialize, both return, and the shop gets one form per
 * title rather than two.
 */

async function syncCourse(db: AppDb, shopId: string, title: string) {
  return db.transaction(async (tx) => {
    const [course] = await tx
      .insert(courses)
      .values({ shopId, title, slug: title.toLowerCase().replaceAll(" ", "-") })
      .returning({ id: courses.id });
    if (!course) throw new Error("course insert returned no row");
    return attachStandardCourseForms(tx, {
      shopId,
      courseId: course.id,
      titles: ["Medical statement"],
    });
  });
}

describePostgres("attachStandardCourseForms under real concurrency", () => {
  it("lets two course syncs in one shop both finish, with one form per title", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);

    const gate = await holdRowLock(pg, shopCounterLock(shop.id));
    const syncs = [
      syncCourse(pg.connect(), shop.id, "Open Water"),
      syncCourse(pg.connect(), shop.id, "Advanced Open Water"),
    ];
    await waitForLockWaiters(pg.db, syncs.length);
    await gate.release();

    const results = await Promise.all(syncs);
    expect(results.map((result) => result.attached)).toEqual([1, 1]);
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1);
    const forms = await pg.db
      .select({ id: courseFormVersions.formId })
      .from(courseFormVersions)
      .where(
        and(
          eq(courseFormVersions.shopId, shop.id),
          eq(courseFormVersions.title, "Medical statement"),
        ),
      );
    expect(forms).toHaveLength(1);
  });
});
