import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  createCourseForm,
  listCourseForms,
  requiredCourseFormsForTrips,
  saveCourseFormVersion,
  setCourseFormRequirements,
} from "./course-forms";
import { activityEvents, bookings, courseFormVersions, people, shops, trips } from "./schema";
import { listStaff } from "./trips";

const fileCtx = fileScopedShopContext();

const BODY =
  "I have answered every health question below truthfully and will tell the instructor before any session if anything about my health changes.";

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

async function formOn(ctx: Awaited<ReturnType<typeof courseContext>>, medicalScreening?: boolean) {
  const form = await createCourseForm(ctx.db, {
    shopId: ctx.shop.id,
    title: "Health questionnaire",
    body: BODY,
    actorPersonId: ctx.staff.id,
    ...(medicalScreening === undefined ? {} : { medicalScreening }),
  });
  await setCourseFormRequirements(ctx.db, {
    mayNarrow: true,
    shopId: ctx.shop.id,
    courseId: ctx.seat.courseId,
    formIds: [form.id],
  });
  return form;
}

async function requiredFor(ctx: Awaited<ReturnType<typeof courseContext>>) {
  const map = await requiredCourseFormsForTrips(ctx.db, ctx.shop.id, [ctx.seat.tripId]);
  return (map.get(ctx.seat.tripId) ?? []).filter((row) => row.title === "Health questionnaire");
}

describe("course forms — the medical-screening marker (#2337)", () => {
  it("is off by default and carried on the required form when set", async () => {
    const ctx = await courseContext();
    await formOn(ctx);
    expect((await requiredFor(ctx))[0]?.medicalScreening).toBeUndefined();
  });

  it("travels from a form saved as medical to the list a departure's readiness reads", async () => {
    const ctx = await courseContext();
    await formOn(ctx, true);
    expect((await requiredFor(ctx))[0]).toMatchObject({ medicalScreening: true });
  });

  it("flips on an existing form without writing a version, so nobody signs again", async () => {
    const ctx = await courseContext();
    const form = await formOn(ctx, false);
    const summary = (await listCourseForms(ctx.db, ctx.shop.id)).find((row) => row.id === form.id);
    if (!summary) throw new Error("form missing");
    const saved = await saveCourseFormVersion(ctx.db, {
      shopId: ctx.shop.id,
      formId: form.id,
      title: summary.title,
      body: summary.body,
      actorPersonId: ctx.staff.id,
      medicalScreening: true,
    });
    expect(saved).toEqual({ ok: true, versioned: false, marked: true });
    const versions = await ctx.db
      .select({ id: courseFormVersions.id })
      .from(courseFormVersions)
      .where(eq(courseFormVersions.formId, form.id));
    expect(versions).toHaveLength(1);
    expect((await requiredFor(ctx))[0]).toMatchObject({ medicalScreening: true });
  });

  it("keeps the marker when a save names none, and clears it only when told", async () => {
    const ctx = await courseContext();
    const form = await formOn(ctx, true);
    const base = {
      shopId: ctx.shop.id,
      formId: form.id,
      title: "Health questionnaire",
      body: `${BODY} Reworded.`,
      actorPersonId: ctx.staff.id,
    };
    expect(await saveCourseFormVersion(ctx.db, base)).toMatchObject({
      versioned: true,
      marked: false,
    });
    expect((await requiredFor(ctx))[0]).toMatchObject({ medicalScreening: true });
    expect(await saveCourseFormVersion(ctx.db, { ...base, medicalScreening: false })).toMatchObject(
      { marked: true },
    );
    expect((await requiredFor(ctx))[0]?.medicalScreening).toBeUndefined();
  });

  it("writes an activity line naming the staffer on every flip, and none when nothing flipped", async () => {
    const ctx = await courseContext();
    const form = await formOn(ctx, false);
    const base = {
      shopId: ctx.shop.id,
      formId: form.id,
      title: "Health questionnaire",
      body: BODY,
      actorPersonId: ctx.staff.id,
    };
    const lines = async () =>
      (
        await ctx.db
          .select({
            code: activityEvents.code,
            actorPersonId: activityEvents.actorPersonId,
            params: activityEvents.params,
          })
          .from(activityEvents)
          .where(
            and(
              eq(activityEvents.shopId, ctx.shop.id),
              eq(activityEvents.code, "course_form_medical_changed"),
            ),
          )
      ).filter((line) => line.params.form === "Health questionnaire");
    await saveCourseFormVersion(ctx.db, { ...base, medicalScreening: false });
    await saveCourseFormVersion(ctx.db, base);
    expect(await lines()).toHaveLength(0);
    await saveCourseFormVersion(ctx.db, { ...base, medicalScreening: true });
    await saveCourseFormVersion(ctx.db, { ...base, medicalScreening: false });
    const written = await lines();
    expect(written).toHaveLength(2);
    expect(written.map((line) => line.params.marked).sort()).toEqual(["no", "yes"]);
    expect(written.every((line) => line.actorPersonId === ctx.staff.id)).toBe(true);
    expect(written.every((line) => line.params.actor === ctx.staff.fullName)).toBe(true);
  });

  it("will not mark another shop's form", async () => {
    const ctx = await courseContext();
    const form = await formOn(ctx, false);
    const [other] = await ctx.db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-medical", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const saved = await saveCourseFormVersion(ctx.db, {
      shopId: other.id,
      formId: form.id,
      title: "Health questionnaire",
      body: BODY,
      actorPersonId: ctx.staff.id,
      medicalScreening: true,
    });
    expect(saved).toEqual({ ok: false, reason: "not_found" });
    expect((await requiredFor(ctx))[0]?.medicalScreening).toBeUndefined();
  });
});
