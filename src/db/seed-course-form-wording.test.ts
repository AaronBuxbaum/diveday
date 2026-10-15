import { and, eq, gt, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { courseFormAwaitingText } from "@/lib/course-forms";
import { seededShopContext } from "@/test/db";
import { courseFormsAwaitingTextByCourse, listCourseForms } from "./course-forms";
import { listTripReadiness } from "./readiness";
import { courses, trips } from "./schema";

/**
 * **The demo's course forms are worded and signed** (fourth review, item 53):
 * no "Needs your text", no "courses need their agency form wording", and no
 * seeded student left owing a form the seed just put words into.
 */
describe("the seeded course forms", () => {
  it("carry the shop's words, so no course is waiting on them", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const forms = await listCourseForms(db, shop.id);
    expect(forms.length).toBeGreaterThan(0);
    expect(forms.filter((form) => courseFormAwaitingText(form.body))).toEqual([]);
    const courseIds = (
      await db.select({ id: courses.id }).from(courses).where(eq(courses.shopId, shop.id))
    ).map((course) => course.id);
    expect((await courseFormsAwaitingTextByCourse(db, shop.id, courseIds)).size).toBe(0);
  });

  it("leave no booked student owing one", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const sessions = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          isNotNull(trips.courseId),
          eq(trips.status, "scheduled"),
          gt(trips.startsAt, nowDate()),
        ),
      );
    expect(sessions.length).toBeGreaterThan(0);
    let students = 0;
    for (const session of sessions) {
      const rows = await listTripReadiness(db, shop.id, session.id);
      for (const row of rows) {
        students += 1;
        expect(row.owedCourseForms).toEqual([]);
      }
    }
    expect(students).toBeGreaterThan(0);
  });
});
