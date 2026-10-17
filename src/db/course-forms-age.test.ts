import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { courseTemplateSnapshot, getCourseTemplate } from "@/content/course-templates";
import { calendarDateInTimezone, shiftCalendarDateMonths } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  createCourseForm,
  getCourseFormsForBooking,
  listCourseFormAgeBounds,
  listCourseFormRequirements,
  listCourseForms,
  setCourseFormRequirements,
  signCourseForm,
} from "./course-forms";
import { getCourseBySlug, getCourseTemplateUpdate, pullCourseTemplateUpdates } from "./courses";
import { getBookingReadiness } from "./readiness";
import {
  bookings,
  courseFormRecords,
  courseFormRequirements,
  courseForms,
  courses,
  people,
  trips,
} from "./schema";
import { listStaff } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();

const BODY =
  "I understand the course's in-water sessions follow the instructor's plan, and I will tell the instructor before any session if anything about my health changes.";

/** A seeded upcoming course session with a live seat on it, and a staffer. */
async function courseContext() {
  const { db, shop } = fileCtx;
  const now = nowDate();
  const [seat] = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      fullName: people.fullName,
      tripId: trips.id,
      courseId: trips.courseId,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        isNotNull(trips.courseId),
        ne(bookings.status, "cancelled"),
        ne(trips.status, "cancelled"),
        gt(trips.startsAt, now),
      ),
    )
    .limit(1);
  if (!seat?.courseId) throw new Error("seed has no upcoming course seat");
  // An adult on file, so the guardian rule is a choice each test makes.
  await db.update(people).set({ dateOfBirth: "1990-04-02" }).where(eq(people.id, seat.personId));
  await db
    .update(bookings)
    .set({ identityUnconfirmedAt: null })
    .where(eq(bookings.id, seat.bookingId));
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, seat: { ...seat, courseId: seat.courseId }, staff: staff.person, now };
}

async function requireOneForm(ctx: Awaited<ReturnType<typeof courseContext>>) {
  const form = await createCourseForm(ctx.db, {
    shopId: ctx.shop.id,
    title: "Course liability release",
    body: BODY,
    actorPersonId: ctx.staff.id,
  });
  const set = await setCourseFormRequirements(ctx.db, {
    mayNarrow: true,
    shopId: ctx.shop.id,
    courseId: ctx.seat.courseId,
    formIds: [form.id],
  });
  expect(set).toEqual({ ok: true });
  // By id: the seeded shop already holds the agency forms its templates name.
  const summary = (await listCourseForms(ctx.db, ctx.shop.id)).find((row) => row.id === form.id);
  if (!summary) throw new Error("form missing");
  return summary;
}

/**
 * **A form asked only of the youngest students** (issue #2265, Aaron
 * 2026-10-13): an optional age on a course's form requirement, measured on
 * the session's first day in the shop's zone. PADI's Youth Diving
 * acknowledgment (10615) is the case, at 11.
 */
describe("course forms — a form bound to an age (in-memory PGlite)", () => {
  it("sets up the seeded Open Water youth acknowledgment at 11, and nothing else bound", async () => {
    const { db, shop } = fileCtx;
    const openWater = await getCourseBySlug(db, shop.id, "open-water-diver");
    if (!openWater) throw new Error("seeded Open Water missing");
    const forms = await listCourseForms(db, shop.id);
    const bounds = await listCourseFormAgeBounds(db, shop.id, openWater.id);
    expect(
      [...bounds].map(([formId, age]) => [forms.find((form) => form.id === formId)?.title, age]),
    ).toEqual([["Youth Diving: Responsibility and Risks Acknowledgment", 11]]);
  });

  it("does not ask an adult on the course, and asks a ten-year-old on the same session", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    expect(
      await setCourseFormRequirements(ctx.db, {
        mayNarrow: true,
        shopId: ctx.shop.id,
        courseId: ctx.seat.courseId,
        formIds: [form.id],
        maxAgeYears: new Map([[form.id, 11]]),
      }),
    ).toEqual({ ok: true });

    const codes = async () =>
      (await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.blockers.map(
        (blocker) => blocker.code,
      );
    expect(await codes()).not.toContain("course_form_unsigned");
    expect(
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.outstanding,
    ).toEqual([]);

    // Ten on the session's first day, in the shop's zone.
    const [trip] = await ctx.db
      .select({ startsAt: trips.startsAt })
      .from(trips)
      .where(eq(trips.id, ctx.seat.tripId));
    if (!trip) throw new Error("session missing");
    const firstDay = calendarDateInTimezone(trip.startsAt, ctx.shop.timezone);
    await ctx.db
      .update(people)
      .set({ dateOfBirth: shiftCalendarDateMonths(firstDay, -120) })
      .where(eq(people.id, ctx.seat.personId));
    expect(await codes()).toContain("course_form_unsigned");
    expect(
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.outstanding.map(
        (row) => row.formId,
      ),
    ).toEqual([form.id]);
  });

  it("names the missing birthday, and takes a youth form only with a guardian beside it", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await setCourseFormRequirements(ctx.db, {
      mayNarrow: true,
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      formIds: [form.id],
      maxAgeYears: new Map([[form.id, 11]]),
    });
    await ctx.db.update(people).set({ dateOfBirth: null }).where(eq(people.id, ctx.seat.personId));
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers).toContainEqual({
      code: "course_form_unsigned",
      params: { formTitle: form.title, formMaxAge: 11 },
    });
    const [owed] =
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.outstanding ?? [];
    if (!owed) throw new Error("youth form not owed");
    const base = {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: owed.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    };
    expect(await signCourseForm(ctx.db, base)).toEqual({ ok: false, reason: "guardian_required" });
    expect(
      await signCourseForm(ctx.db, {
        ...base,
        guardian: { name: "Rosa Guardian", relationship: "parent", agreed: true },
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses an age out of range, changing nothing, and a blank asks everyone again", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    for (const age of [0, 121, 10.5]) {
      expect(
        await setCourseFormRequirements(ctx.db, {
          mayNarrow: true,
          shopId: ctx.shop.id,
          courseId: ctx.seat.courseId,
          formIds: [form.id],
          maxAgeYears: new Map([[form.id, age]]),
        }),
      ).toEqual({ ok: false, reason: "invalid_age" });
    }
    expect((await listCourseFormAgeBounds(ctx.db, ctx.shop.id, ctx.seat.courseId)).size).toBe(0);

    await setCourseFormRequirements(ctx.db, {
      mayNarrow: true,
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      formIds: [form.id],
      maxAgeYears: new Map([[form.id, 11]]),
    });
    await setCourseFormRequirements(ctx.db, {
      mayNarrow: true,
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      formIds: [form.id],
      maxAgeYears: new Map(),
    });
    expect((await listCourseFormAgeBounds(ctx.db, ctx.shop.id, ctx.seat.courseId)).size).toBe(0);
    expect(
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.outstanding.map(
        (row) => row.formId,
      ),
    ).toEqual([form.id]);
  });

  it("refuses an age on a medical-screening form (G3)", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await ctx.db
      .update(courseForms)
      .set({ medicalScreening: true })
      .where(eq(courseForms.id, form.id));
    expect(
      await setCourseFormRequirements(ctx.db, {
        shopId: ctx.shop.id,
        courseId: ctx.seat.courseId,
        formIds: [form.id],
        maxAgeYears: new Map([[form.id, 11]]),
        mayNarrow: true,
      }),
    ).toEqual({ ok: false, reason: "medical_bound" });
    expect((await listCourseFormAgeBounds(ctx.db, ctx.shop.id, ctx.seat.courseId)).size).toBe(0);
  });

  it("refuses a bound that asks fewer students, or a dropped form, from a writer who may not (G1)", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    const write = (bound: number | null, formIds = [form.id]) =>
      setCourseFormRequirements(ctx.db, {
        shopId: ctx.shop.id,
        courseId: ctx.seat.courseId,
        formIds,
        maxAgeYears: new Map(bound === null ? [] : [[form.id, bound]]),
        mayNarrow: false,
      });
    // A bound on a form everyone was asked: fewer students sign it.
    expect(await write(11)).toEqual({ ok: false, reason: "not_authorized" });
    expect((await listCourseFormAgeBounds(ctx.db, ctx.shop.id, ctx.seat.courseId)).size).toBe(0);
    // Taking the form off.
    expect(await write(null, [])).toEqual({ ok: false, reason: "not_authorized" });
    expect(await listCourseFormRequirements(ctx.db, ctx.shop.id, ctx.seat.courseId)).toEqual([
      form.id,
    ]);
    // A manager narrows; then raising or clearing the bound asks more, and is anyone's.
    await setCourseFormRequirements(ctx.db, {
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      formIds: [form.id],
      maxAgeYears: new Map([[form.id, 11]]),
      mayNarrow: true,
    });
    expect(await write(10)).toEqual({ ok: false, reason: "not_authorized" });
    expect(await write(14)).toEqual({ ok: true });
    expect(await write(null)).toEqual({ ok: true });
  });

  it("refuses an age at the column, whatever the writer", async () => {
    const ctx = await courseContext();
    await requireOneForm(ctx);
    await expect(
      ctx.db.transaction((tx) =>
        tx
          .update(courseFormRequirements)
          .set({ maxAgeYears: 0 })
          .where(eq(courseFormRequirements.courseId, ctx.seat.courseId)),
      ),
    ).rejects.toThrow();
  });
});

/**
 * **A shop already on Open Water version 2 is offered 10615** (reviews G2/H5
 * of #2265): the youth acknowledgment came with version 3, so a course that
 * follows version 2 sees an update, and pulling it sets the form up with its
 * age.
 */
describe("course forms — Open Water version 3 brings the youth acknowledgment", () => {
  const YOUTH = "Youth Diving: Responsibility and Risks Acknowledgment";

  async function openWaterOnVersionTwo() {
    const { db, shop } = fileCtx;
    const openWater = await getCourseBySlug(db, shop.id, "open-water-diver");
    const template = getCourseTemplate("open-water-diver");
    if (!openWater || !template) throw new Error("seeded Open Water missing");
    const snapshot = courseTemplateSnapshot(template);
    const youth = (await listCourseForms(db, shop.id)).find((form) => form.title === YOUTH);
    if (!youth) throw new Error("seeded youth form missing");
    await db
      .update(courses)
      .set({
        sourceTemplateVersion: 2,
        sourceTemplateSnapshot: {
          ...snapshot,
          standardForms: (snapshot.standardForms ?? []).filter((title) => title !== YOUTH),
        },
      })
      .where(eq(courses.id, openWater.id));
    return { db, shop, openWater, youth };
  }

  it("offers the update to a course on version 2, and pulling it asks 10615 up to age 11", async () => {
    const { db, shop, openWater, youth } = await openWaterOnVersionTwo();
    // The course never had the youth form: version 2 did not name it.
    await db.delete(courseFormRequirements).where(eq(courseFormRequirements.formId, youth.id));

    expect(await getCourseTemplateUpdate(db, shop.id, openWater.id)).not.toBeNull();
    await pullCourseTemplateUpdates(db, shop.id, openWater.id, "preserve-shop-edits");

    expect(await listCourseFormRequirements(db, shop.id, openWater.id)).toContain(youth.id);
    expect((await listCourseFormAgeBounds(db, shop.id, openWater.id)).get(youth.id)).toBe(11);
  });

  it("puts the age on a same-titled form the course already asks everyone", async () => {
    const { db, shop, openWater, youth } = await openWaterOnVersionTwo();
    await db
      .update(courseFormRequirements)
      .set({ maxAgeYears: null })
      .where(eq(courseFormRequirements.formId, youth.id));

    await pullCourseTemplateUpdates(db, shop.id, openWater.id, "preserve-shop-edits");

    expect((await listCourseFormAgeBounds(db, shop.id, openWater.id)).get(youth.id)).toBe(11);
  });

  it("leaves a shop's own age on that form alone", async () => {
    const { db, shop, openWater, youth } = await openWaterOnVersionTwo();
    await db
      .update(courseFormRequirements)
      .set({ maxAgeYears: 13 })
      .where(eq(courseFormRequirements.formId, youth.id));

    await pullCourseTemplateUpdates(db, shop.id, openWater.id, "preserve-shop-edits");

    expect((await listCourseFormAgeBounds(db, shop.id, openWater.id)).get(youth.id)).toBe(13);
  });
});

describe("course forms — placeholders, filled at signing (in-memory PGlite)", () => {
  it("fills the shop, course and instructors into the words, and keeps what they were", async () => {
    const ctx = await courseContext();
    const created = await createCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      title: "Agency release",
      body: `I release {shopName} and {instructorNames} for {courseTitle}. ${BODY}`,
      actorPersonId: ctx.staff.id,
    });
    await setCourseFormRequirements(ctx.db, {
      mayNarrow: true,
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      formIds: [created.id],
    });
    const [course] = await ctx.db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, ctx.seat.courseId));
    const forms = await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    const [owed] = forms?.outstanding ?? [];
    expect(owed?.body).toContain(`I release ${ctx.shop.name} and `);
    expect(owed?.body).toContain(`for ${course?.title}.`);
    expect(owed?.body).not.toContain("{");

    await signCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: owed?.versionId ?? "",
      signerName: ctx.seat.fullName,
      agreed: true,
    });
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.bookingId, ctx.seat.bookingId));
    expect(record).toMatchObject({
      formBody: owed?.body,
      courseTitle: course?.title,
      tripId: ctx.seat.tripId,
      instructorNames: forms?.enrollment.context.instructorNames,
    });
    // A later rename never rewrites what was agreed to.
    await ctx.db
      .update(courses)
      .set({ title: "Renamed course" })
      .where(eq(courses.id, ctx.seat.courseId));
    const [kept] = await ctx.db
      .select({ courseTitle: courseFormRecords.courseTitle })
      .from(courseFormRecords)
      .where(eq(courseFormRecords.bookingId, ctx.seat.bookingId));
    expect(kept?.courseTitle).toBe(course?.title);
  });
});
