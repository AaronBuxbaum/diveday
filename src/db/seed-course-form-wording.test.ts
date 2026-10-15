import { and, eq, gt, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { courseFormAwaitingText } from "@/lib/course-forms";
import { utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { courseFormsAwaitingTextByCourse, listCourseForms } from "./course-forms";
import { listTripReadiness } from "./readiness";
import { bookings, courseFormRecords, courses, trips } from "./schema";
import { DEMO_SHOP_TIMEZONE } from "./seed-clock";
import { guardianNameFor } from "./seed-course-form-wording";

/**
 * **The demo's course forms are worded and signed** (fourth review, item 53):
 * no "Needs your text", no "courses need their agency form wording", and no
 * seeded student left owing a form the seed just put words into.
 */
describe("guardianNameFor", () => {
  it("invents a parent sharing the student's surname", () => {
    expect(guardianNameFor("Mia Torres")).toBe("Alex Torres");
  });

  it("never gives a student called Alex a co-signer with their own name", () => {
    expect(guardianNameFor("Alex Torres")).toBe("Sam Torres");
  });
});

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

  it("were signed one by one at the desk, not all in the same second", async () => {
    // Layer r4-6 review: one `signedAt` for every student is the "a hundred
    // people signed in the same second" shape the waiver evidence seed exists
    // to remove.
    const { db, shop } = await seededShopContext({ history: true });
    const now = nowDate();
    const rows = await db
      .select({
        signedAt: courseFormRecords.signedAt,
        method: courseFormRecords.signatureMethod,
      })
      .from(courseFormRecords)
      .innerJoin(bookings, eq(bookings.id, courseFormRecords.bookingId))
      .where(
        and(
          eq(courseFormRecords.shopId, shop.id),
          eq(courseFormRecords.signatureMethod, "in_person_attested"),
        ),
      );
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((row) => row.signedAt.getTime())).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.signedAt.getTime()).toBeLessThanOrEqual(now.getTime());
      const { hour } = utcToWallTime(row.signedAt, DEMO_SHOP_TIMEZONE);
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(18);
    }
  });
});
