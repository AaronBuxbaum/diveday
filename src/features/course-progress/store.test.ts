import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookings, courseSessionProgress, courses, trips } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { courseProgressByPerson, courseStepTitles, recordCourseStepDone } from "./index";

const ctx = fileScopedShopContext({ history: true });

describe("courseStepTitles", () => {
  it("reads each outline day once, in order", () => {
    expect(
      courseStepTitles([{ title: " Pool 1 " }, { title: "OW 1" }, { title: "Pool 1" }]),
    ).toEqual(["Pool 1", "OW 1"]);
  });
});

describe("course session progress (in-memory PGlite)", () => {
  async function courseSeat() {
    const { db, shop } = ctx;
    const [seat] = await db
      .select({ id: bookings.id, personId: bookings.personId, courseId: trips.courseId })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(and(eq(bookings.shopId, shop.id)))
      .then((rows) => rows.filter((row) => row.courseId));
    if (!seat?.courseId) throw new Error("no course seat in the seed");
    await db
      .update(courses)
      .set({
        scheduleDays: [
          { title: "Pool session 1", items: [] },
          { title: "OW dive 2", items: [] },
        ],
      })
      .where(eq(courses.id, seat.courseId));
    const [staff] = await db.select({ id: bookings.personId }).from(bookings).limit(1);
    return { ...seat, courseId: seat.courseId, staffPersonId: staff?.id ?? seat.personId };
  }

  it("ticks a step once, reads it back by person, and takes it back", async () => {
    const { db, shop } = ctx;
    const seat = await courseSeat();
    const tick = (done: boolean, stepTitle = "Pool session 1") =>
      recordCourseStepDone(db, {
        shopId: shop.id,
        bookingId: seat.id,
        staffPersonId: seat.staffPersonId,
        stepTitle,
        done,
      });
    expect(await tick(true)).toEqual({ ok: true });
    expect(await tick(true)).toEqual({ ok: true });
    const rows = await db.select().from(courseSessionProgress);
    expect(rows.filter((row) => row.personId === seat.personId)).toHaveLength(1);
    const read = await courseProgressByPerson(db, {
      shopId: shop.id,
      courseId: seat.courseId,
      personIds: [seat.personId],
    });
    expect([...(read.get(seat.personId)?.keys() ?? [])]).toEqual(["Pool session 1"]);
    expect(await tick(false)).toEqual({ ok: true });
    expect(
      (
        await courseProgressByPerson(db, {
          shopId: shop.id,
          courseId: seat.courseId,
          personIds: [seat.personId],
        })
      ).size,
    ).toBe(0);
  });

  it("refuses a step the outline does not name, and another shop's seat", async () => {
    const { db, shop } = ctx;
    const seat = await courseSeat();
    const base = { bookingId: seat.id, staffPersonId: seat.staffPersonId, done: true };
    expect(
      await recordCourseStepDone(db, { ...base, shopId: shop.id, stepTitle: "Made up" }),
    ).toEqual({ ok: false, reason: "unknown_step" });
    expect(
      await recordCourseStepDone(db, {
        ...base,
        shopId: "00000000-0000-4000-8000-000000000000",
        stepTitle: "Pool session 1",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});
