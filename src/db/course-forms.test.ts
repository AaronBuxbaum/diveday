import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { courseTemplateSnapshot, getCourseTemplate } from "@/content/course-templates";
import {
  calendarDateInTimezone,
  shiftCalendarDate,
  shiftCalendarDateMonths,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { verifyCourseFormIntegrity } from "@/lib/course-form-integrity";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import {
  attachStandardCourseForms,
  courseFormResignImpact,
  courseFormsAwaitingTextByCourse,
  courseUpcomingEnrollment,
  createCourseForm,
  deleteCourseForm,
  getCourseFormsForBooking,
  listCourseFormRequirements,
  listCourseForms,
  owedCourseFormsByBooking,
  recordPaperCourseForm,
  saveCourseFormVersion,
  setCourseFormRequirements,
  signCourseForm,
} from "./course-forms";
import { getCourseBySlug, pullCourseTemplateUpdates } from "./courses";
import { getDiverMergePreview, mergeDiverRecords } from "./diver-merge";
import { loadDiverExportBundleInput, loadShopExportBundleInput } from "./export";
import { getBookingReadiness } from "./readiness";
import {
  bookings,
  courseFormRecords,
  courseFormRequirements,
  courseFormVersions,
  courses,
  people,
  personRoles,
  shops,
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

describe("course forms — the agency's standard forms (in-memory PGlite)", () => {
  const AGENCY_TITLE = "Agency course release";

  it("sets up the seeded Open Water course's forms by title, empty, and asks nobody to sign them", async () => {
    const { db, shop } = fileCtx;
    const openWater = await getCourseBySlug(db, shop.id, "open-water-diver");
    const template = getCourseTemplate("open-water-diver");
    if (!openWater || !template) throw new Error("seeded Open Water missing");
    const forms = await listCourseForms(db, shop.id);
    const required = await listCourseFormRequirements(db, shop.id, openWater.id);
    expect(required.map((id) => forms.find((form) => form.id === id)?.title)).toEqual(
      (template.standardForms ?? []).map((form) => form.title),
    );
    for (const id of required) {
      expect(forms.find((form) => form.id === id)?.body).toBe("");
    }
    const awaiting = await courseFormsAwaitingTextByCourse(db, shop.id, [openWater.id]);
    expect(awaiting.get(openWater.id)?.map((form) => form.formId)).toEqual(required);
  });

  it("blocks no one, sends nothing and refuses a signature until the shop pastes the text in", async () => {
    const ctx = await courseContext();
    // The seat's course asks for this one form only, made the template's way.
    await setCourseFormRequirements(ctx.db, {
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      formIds: [],
    });
    expect(
      await attachStandardCourseForms(ctx.db, {
        shopId: ctx.shop.id,
        courseId: ctx.seat.courseId,
        titles: [AGENCY_TITLE],
      }),
    ).toEqual({ created: 1, attached: 1 });
    const form = (await listCourseForms(ctx.db, ctx.shop.id)).find(
      (row) => row.title === AGENCY_TITLE,
    );
    if (!form) throw new Error("agency form missing");

    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
    expect((await owedCourseFormsByBooking(ctx.db, ctx.shop.id, [ctx.seat.tripId])).size).toBe(0);
    expect(
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formVersionId: form.versionId,
        signerName: ctx.seat.fullName,
        agreed: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await recordPaperCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formId: form.id,
        recordedByPersonId: ctx.staff.id,
        paperCopyConfirmed: true,
      }),
    ).toMatchObject({ ok: false });

    // The staffer pastes the wording in: now it is asked, and owed.
    await saveCourseFormVersion(ctx.db, {
      shopId: ctx.shop.id,
      formId: form.id,
      title: form.title,
      body: BODY,
      actorPersonId: ctx.staff.id,
    });
    const after = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(after?.blockers).toContainEqual({
      code: "course_form_unsigned",
      params: { formTitle: AGENCY_TITLE },
    });
    expect(
      (await courseFormsAwaitingTextByCourse(ctx.db, ctx.shop.id, [ctx.seat.courseId])).size,
    ).toBe(0);
  });

  it("reuses a form the shop already has by title, adds only what is missing, and never reorders", async () => {
    const ctx = await courseContext();
    const own = await requireOneForm(ctx);
    const again = await attachStandardCourseForms(ctx.db, {
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      titles: ["  course LIABILITY release ", AGENCY_TITLE],
    });
    expect(again).toEqual({ created: 1, attached: 1 });
    const required = await listCourseFormRequirements(ctx.db, ctx.shop.id, ctx.seat.courseId);
    expect(required[0]).toBe(own.id);
    expect(required).toHaveLength(2);
    // The shop's own text is untouched.
    const kept = (await listCourseForms(ctx.db, ctx.shop.id)).find((row) => row.id === own.id);
    expect(kept).toMatchObject({ body: BODY, version: 1 });
    // A second run is a no-op.
    expect(
      await attachStandardCourseForms(ctx.db, {
        shopId: ctx.shop.id,
        courseId: ctx.seat.courseId,
        titles: [AGENCY_TITLE],
      }),
    ).toEqual({ created: 0, attached: 0 });
  });

  it("writes nothing for another shop's course", async () => {
    const ctx = await courseContext();
    const other = await otherShop(ctx.db);
    expect(
      await attachStandardCourseForms(ctx.db, {
        shopId: other.id,
        courseId: ctx.seat.courseId,
        titles: [AGENCY_TITLE],
      }),
    ).toEqual({ created: 0, attached: 0 });
    expect(await listCourseForms(ctx.db, other.id)).toEqual([]);
    expect(await courseFormsAwaitingTextByCourse(ctx.db, other.id, [ctx.seat.courseId])).toEqual(
      new Map(),
    );
  });

  /** Seeded Open Water, with an older template baseline so a sync has something to pull. */
  async function openWaterBehindItsTemplate(baselineForms: string[] | undefined) {
    const { db, shop } = fileCtx;
    const openWater = await getCourseBySlug(db, shop.id, "open-water-diver");
    const template = getCourseTemplate("open-water-diver");
    if (!openWater || !template) throw new Error("seeded Open Water missing");
    const { standardForms: _latest, ...rest } = courseTemplateSnapshot(template);
    await db
      .update(courses)
      .set({
        sourceTemplateVersion: 1,
        sourceTemplateSnapshot: {
          ...rest,
          summary: "Older words",
          ...(baselineForms ? { standardForms: baselineForms } : {}),
        },
      })
      .where(eq(courses.id, openWater.id));
    return { db, shop, openWater, template };
  }

  it("never puts back a form the shop took off, when a sync keeps the shop's edits", async () => {
    const titles = (getCourseTemplate("open-water-diver")?.standardForms ?? []).map((f) => f.title);
    const { db, shop, openWater } = await openWaterBehindItsTemplate(titles);
    await setCourseFormRequirements(db, { shopId: shop.id, courseId: openWater.id, formIds: [] });

    const pulled = await pullCourseTemplateUpdates(
      db,
      shop.id,
      openWater.id,
      "preserve-shop-edits",
    );

    expect(pulled.status).toBe("updated");
    expect(await listCourseFormRequirements(db, shop.id, openWater.id)).toEqual([]);
  });

  it("adds only a form new in this template version, and not one the shop already declined", async () => {
    const [first, second] = (getCourseTemplate("open-water-diver")?.standardForms ?? []).map(
      (form) => form.title,
    );
    if (!first || !second) throw new Error("Open Water names two forms");
    // The previous version named only the first form; this one adds the second.
    const { db, shop, openWater } = await openWaterBehindItsTemplate([first]);
    const before = await listCourseFormRequirements(db, shop.id, openWater.id);
    const forms = await listCourseForms(db, shop.id);
    const firstId = forms.find((form) => form.title === first)?.id;
    const secondId = forms.find((form) => form.title === second)?.id;
    // The shop keeps the first and took the second off before the sync.
    await setCourseFormRequirements(db, {
      shopId: shop.id,
      courseId: openWater.id,
      formIds: before.filter((id) => id !== secondId),
    });

    await pullCourseTemplateUpdates(db, shop.id, openWater.id, "preserve-shop-edits");

    // New in this version, but taken off by the shop: its soft-deleted row is the shop's no.
    expect(await listCourseFormRequirements(db, shop.id, openWater.id)).toEqual([firstId]);
  });

  it("adds a form new in this template version that the course never had", async () => {
    const [first, second] = (getCourseTemplate("open-water-diver")?.standardForms ?? []).map(
      (form) => form.title,
    );
    if (!first || !second) throw new Error("Open Water names two forms");
    const { db, shop, openWater } = await openWaterBehindItsTemplate([first]);
    // A course that never listed the second form at all: delete the seeded form,
    // which takes its requirement row with it, then forget that row ever was.
    const secondId = (await listCourseForms(db, shop.id)).find((form) => form.title === second)?.id;
    if (!secondId) throw new Error("seeded second form missing");
    await db.delete(courseFormRequirements).where(eq(courseFormRequirements.formId, secondId));

    await pullCourseTemplateUpdates(db, shop.id, openWater.id, "preserve-shop-edits");

    const required = await listCourseFormRequirements(db, shop.id, openWater.id);
    expect(required).toHaveLength(2);
    expect(required).toContain(secondId);
  });
});

async function otherShop(db: AppDb) {
  const [other] = await db
    .insert(shops)
    .values({ name: "Other Reef", slug: "other-reef-forms", timezone: "America/New_York" })
    .returning();
  if (!other) throw new Error("other shop insert failed");
  return other;
}

describe("course forms — authoring (in-memory PGlite)", () => {
  it("versions a form by insertion and writes nothing for the same words", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    expect(form.version).toBe(1);

    expect(
      await saveCourseFormVersion(ctx.db, {
        shopId: ctx.shop.id,
        formId: form.id,
        title: ` ${form.title} `,
        body: form.body,
        actorPersonId: ctx.staff.id,
      }),
    ).toEqual({ ok: true, versioned: false });

    expect(
      await saveCourseFormVersion(ctx.db, {
        shopId: ctx.shop.id,
        formId: form.id,
        title: form.title,
        body: `${BODY} Revised.`,
        actorPersonId: ctx.staff.id,
      }),
    ).toEqual({ ok: true, versioned: true });
    const current = (await listCourseForms(ctx.db, ctx.shop.id)).find((row) => row.id === form.id);
    expect(current).toMatchObject({ id: form.id, version: 2, body: `${BODY} Revised.` });
  });

  it("never edits, requires or deletes another shop's form", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    const other = await otherShop(ctx.db);

    expect(
      await saveCourseFormVersion(ctx.db, {
        shopId: other.id,
        formId: form.id,
        title: "Hijacked",
        body: BODY,
        actorPersonId: ctx.staff.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteCourseForm(ctx.db, { shopId: other.id, formId: form.id })).toBe(false);
    expect(await listCourseForms(ctx.db, other.id)).toEqual([]);

    const foreign = await createCourseForm(ctx.db, {
      shopId: other.id,
      title: "Other shop form",
      body: BODY,
      actorPersonId: ctx.staff.id,
    });
    expect(
      await setCourseFormRequirements(ctx.db, {
        shopId: ctx.shop.id,
        courseId: ctx.seat.courseId,
        formIds: [form.id, foreign.id],
      }),
    ).toEqual({ ok: false, reason: "unknown_form" });
    // A course id from this shop is not one the other shop can write to.
    expect(
      await setCourseFormRequirements(ctx.db, {
        shopId: other.id,
        courseId: ctx.seat.courseId,
        formIds: [foreign.id],
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await listCourseFormRequirements(ctx.db, ctx.shop.id, ctx.seat.courseId)).toEqual([
      form.id,
    ]);
  });

  it("keeps the course's order, and deleting a form takes it off every course", async () => {
    const ctx = await courseContext();
    const first = await requireOneForm(ctx);
    const second = await createCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      title: "Safe diving practices",
      body: BODY,
      actorPersonId: ctx.staff.id,
    });
    await setCourseFormRequirements(ctx.db, {
      shopId: ctx.shop.id,
      courseId: ctx.seat.courseId,
      formIds: [second.id, first.id],
    });
    expect(await listCourseFormRequirements(ctx.db, ctx.shop.id, ctx.seat.courseId)).toEqual([
      second.id,
      first.id,
    ]);
    expect(await deleteCourseForm(ctx.db, { shopId: ctx.shop.id, formId: second.id })).toBe(true);
    expect(await listCourseFormRequirements(ctx.db, ctx.shop.id, ctx.seat.courseId)).toEqual([
      first.id,
    ]);
    const live = (await listCourseForms(ctx.db, ctx.shop.id)).map((form) => form.id);
    expect(live).toContain(first.id);
    expect(live).not.toContain(second.id);
  });
});

describe("course forms — signing and readiness (in-memory PGlite)", () => {
  it("blocks the student until they sign, then clears; booking admission is untouched", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);

    const before = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(before?.blockers).toContainEqual({
      code: "course_form_unsigned",
      params: { formTitle: "Course liability release" },
    });
    const owed = await owedCourseFormsByBooking(ctx.db, ctx.shop.id, [ctx.seat.tripId]);
    expect(owed.get(ctx.seat.bookingId)?.map((row) => row.formId)).toEqual([form.id]);

    const signed = await signCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    });
    expect(signed).toMatchObject({ ok: true, alreadySigned: false });

    const after = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(after?.blockers.map((blocker) => blocker.code)).not.toContain("course_form_unsigned");
    expect(
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.outstanding,
    ).toEqual([]);

    // A double submit settles on the first record.
    const again = await signCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    });
    expect(again).toEqual({
      ok: true,
      recordId: signed.ok ? signed.recordId : "",
      alreadySigned: true,
    });
  });

  it("snapshots the words signed, and a new version is owed again", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await signCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    });
    await saveCourseFormVersion(ctx.db, {
      shopId: ctx.shop.id,
      formId: form.id,
      title: form.title,
      body: `${BODY} Second version.`,
      actorPersonId: ctx.staff.id,
    });
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.bookingId, ctx.seat.bookingId));
    expect(record).toMatchObject({
      formVersion: 1,
      formBody: BODY,
      signatureMethod: "typed_consent",
    });

    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).toContain("course_form_unsigned");

    // The page that still shows version 1 cannot sign it now.
    expect(
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formVersionId: form.versionId,
        signerName: ctx.seat.fullName,
        agreed: true,
      }),
    ).toEqual({ ok: false, reason: "version_changed" });
  });

  it("refuses a name that is not the student's, an unticked box, and another shop's bearer", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    const base = {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    };
    expect(await signCourseForm(ctx.db, { ...base, signerName: "Somebody Else" })).toEqual({
      ok: false,
      reason: "name_mismatch",
    });
    expect(await signCourseForm(ctx.db, { ...base, agreed: false })).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
    const other = await otherShop(ctx.db);
    expect(await signCourseForm(ctx.db, { ...base, shopId: other.id })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await ctx.db.select().from(courseFormRecords)).toEqual([]);
  });

  it("refuses a held seat (H-13): the link holder may not be the student on file", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await ctx.db
      .update(bookings)
      .set({ identityUnconfirmedAt: ctx.now })
      .where(eq(bookings.id, ctx.seat.bookingId));
    expect(
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formVersionId: form.versionId,
        signerName: ctx.seat.fullName,
        agreed: true,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("asks a minor's guardian to sign too, and refuses the student signing as their own guardian", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await ctx.db
      .update(people)
      .set({ dateOfBirth: "2013-03-03" })
      .where(eq(people.id, ctx.seat.personId));
    const base = {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    };
    expect(await signCourseForm(ctx.db, base)).toEqual({ ok: false, reason: "guardian_required" });
    expect(
      await signCourseForm(ctx.db, {
        ...base,
        guardian: { name: ctx.seat.fullName, relationship: "parent", agreed: true },
      }),
    ).toEqual({ ok: false, reason: "guardian_invalid" });
    expect(
      await signCourseForm(ctx.db, {
        ...base,
        guardian: { name: "Rosa Guardian", relationship: "aunt", agreed: true },
      }),
    ).toEqual({ ok: false, reason: "guardian_invalid" });
    const signed = await signCourseForm(ctx.db, {
      ...base,
      guardian: { name: "Rosa Guardian", relationship: "parent", agreed: true },
    });
    expect(signed).toMatchObject({ ok: true });
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
  });

  it("records a paper copy under the staffer's name, and refuses a non-staff recorder", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    expect(
      await recordPaperCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formId: form.id,
        recordedByPersonId: ctx.seat.personId,
        paperCopyConfirmed: true,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    const outcome = await recordPaperCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formId: form.id,
      recordedByPersonId: ctx.staff.id,
      paperCopyConfirmed: true,
    });
    expect(outcome).toMatchObject({ ok: true, alreadySigned: false });
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.bookingId, ctx.seat.bookingId));
    expect(record).toMatchObject({
      signatureMethod: "in_person_attested",
      recordedByPersonId: ctx.staff.id,
      signedName: ctx.seat.fullName,
    });
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
  });

  it("refuses a paper record from a staffer of another shop", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    const other = await otherShop(ctx.db);
    expect(
      await recordPaperCourseForm(ctx.db, {
        shopId: other.id,
        bookingId: ctx.seat.bookingId,
        formId: form.id,
        recordedByPersonId: ctx.staff.id,
        paperCopyConfirmed: true,
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });
  });
});

/**
 * **A signed course form travels with the release's own rules** (ADR
 * 20261008-course-forms): it is in the diver's export and the shop's, its
 * names go when the diver is erased, and it follows the diver into the record
 * a merge keeps.
 */
describe("course forms — export, erasure and merge parity (in-memory PGlite)", () => {
  async function signedSeat() {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    const signed = await signCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    });
    if (!signed.ok) throw new Error(`sign failed: ${signed.reason}`);
    const [owner] = await ctx.db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, ctx.shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    return { ...ctx, form, recordId: signed.recordId, owner };
  }

  it("is in the diver's export with the words they signed, and in the shop's", async () => {
    const ctx = await signedSeat();

    const diver = await loadDiverExportBundleInput(ctx.db, ctx.shop.id, ctx.seat.personId);
    const diverFile = diver?.tables.find((table) => table.file === "course_form_records.csv");
    expect(diverFile?.rows).toHaveLength(1);
    expect(diverFile?.rows[0]).toEqual(
      expect.arrayContaining(["Course liability release", ctx.seat.fullName, BODY]),
    );

    const shop = await loadShopExportBundleInput(ctx.db, ctx.shop.id);
    const shopFile = shop?.tables.find((table) => table.file === "course_form_records.csv");
    expect(shopFile?.rows.map((row) => row[0])).toContain(ctx.recordId);
    const versions = shop?.tables.find((table) => table.file === "course_form_versions.csv");
    expect(versions?.rows.map((row) => row[1])).toContain(ctx.form.id);
  });

  it("seals the signed record, reads an edit made after as invalid, and says so on export (issue #2266)", async () => {
    const ctx = await signedSeat();
    const stored = async () => {
      const [row] = await ctx.db
        .select()
        .from(courseFormRecords)
        .where(eq(courseFormRecords.id, ctx.recordId));
      if (!row) throw new Error("record expected");
      return row;
    };
    const exportedCheck = async () => {
      const shop = await loadShopExportBundleInput(ctx.db, ctx.shop.id);
      const file = shop?.tables.find((table) => table.file === "course_form_records.csv");
      const column = file?.header.indexOf("integrity_check") ?? -1;
      expect(column).toBeGreaterThan(-1);
      return file?.rows.find((row) => row[0] === ctx.recordId)?.[column];
    };

    const sealed = await stored();
    expect(sealed.integrityVersion).toBe(1);
    expect(sealed.integrityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCourseFormIntegrity(sealed)).toBe("valid");
    expect(await exportedCheck()).toBe("valid");

    // Somebody with write access swaps the words after the fact.
    await ctx.db
      .update(courseFormRecords)
      .set({ formBody: `${BODY} And the shop may keep the deposit.` })
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(verifyCourseFormIntegrity(await stored())).toBe("invalid");
    expect(await exportedCheck()).toBe("invalid");

    // And a quiet change of when, or by whom, is caught the same way.
    await ctx.db
      .update(courseFormRecords)
      .set({ formBody: BODY, signedName: "Someone Else" })
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(verifyCourseFormIntegrity(await stored())).toBe("invalid");
    await ctx.db
      .update(courseFormRecords)
      .set({ signedName: sealed.signedName, signedAt: new Date(sealed.signedAt.getTime() - 1000) })
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(verifyCourseFormIntegrity(await stored())).toBe("invalid");
    await ctx.db
      .update(courseFormRecords)
      .set({ signedAt: sealed.signedAt })
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(verifyCourseFormIntegrity(await stored())).toBe("valid");

    // A seal with no hash, or a version this build does not know, is never "valid".
    await ctx.db
      .update(courseFormRecords)
      .set({ integrityVersion: 9 })
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(verifyCourseFormIntegrity(await stored())).toBe("invalid");
    await expect(
      ctx.db
        .update(courseFormRecords)
        .set({ integrityHash: null })
        .where(eq(courseFormRecords.id, ctx.recordId)),
    ).rejects.toThrow();
  });

  it("re-seals an erased record as version 2, and never launders an earlier edit (issue #2266)", async () => {
    const ctx = await signedSeat();
    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: ctx.seat.personId,
      actorPersonId: ctx.owner.id,
    });
    expect(erased.ok).toBe(true);
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.id, ctx.recordId));
    if (!record) throw new Error("record expected");
    expect(record.integrityVersion).toBe(2);
    expect(verifyCourseFormIntegrity(record)).toBe("valid");
    // A name put back on an erased record is not the record that was sealed.
    expect(verifyCourseFormIntegrity({ ...record, signedName: ctx.seat.fullName })).toBe("invalid");

    // A record edited before the erasure stays invalid through it.
    const tampered = await signedSeat();
    await tampered.db
      .update(courseFormRecords)
      .set({ formTitle: "Something else" })
      .where(eq(courseFormRecords.id, tampered.recordId));
    expect(
      (
        await anonymizeDiver(tampered.db, {
          shopId: tampered.shop.id,
          personId: tampered.seat.personId,
          actorPersonId: tampered.owner.id,
        })
      ).ok,
    ).toBe(true);
    const [after] = await tampered.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.id, tampered.recordId));
    if (!after) throw new Error("record expected");
    expect(after.integrityVersion).toBe(1);
    expect(verifyCourseFormIntegrity(after)).toBe("invalid");
  });

  it("never launders a tampered record through a merge (issue #2266)", async () => {
    const ctx = await signedSeat();
    await ctx.db
      .update(courseFormRecords)
      .set({ formTitle: "Something else" })
      .where(eq(courseFormRecords.id, ctx.recordId));
    const [survivor] = await ctx.db
      .insert(people)
      .values({ shopId: ctx.shop.id, fullName: ctx.seat.fullName, dateOfBirth: "1990-04-02" })
      .returning();
    if (!survivor) throw new Error("survivor insert failed");
    await ctx.db.insert(personRoles).values({ personId: survivor.id, role: "diver" });
    const preview = await getDiverMergePreview(ctx.db, ctx.shop.id, ctx.seat.personId, survivor.id);
    const merged = await mergeDiverRecords({
      db: ctx.db,
      shopId: ctx.shop.id,
      personId: ctx.seat.personId,
      survivorId: survivor.id,
      actorPersonId: ctx.owner.id,
      acknowledged: preview?.acknowledgement,
    });
    expect(merged.ok).toBe(true);
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.id, ctx.recordId));
    if (!record) throw new Error("record expected");
    expect(record.personId).toBe(survivor.id);
    expect(verifyCourseFormIntegrity(record)).toBe("invalid");
  });

  it("loses the signer's name on erasure and keeps the fact of the signature", async () => {
    const ctx = await signedSeat();

    const erased = await anonymizeDiver(ctx.db, {
      shopId: ctx.shop.id,
      personId: ctx.seat.personId,
      actorPersonId: ctx.owner.id,
    });
    expect(erased.ok).toBe(true);

    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(record).toMatchObject({
      signedName: null,
      guardianName: null,
      anonymizedByPersonId: ctx.owner.id,
      formVersion: 1,
      signatureMethod: "typed_consent",
    });
    expect(record?.anonymizedAt).toBeInstanceOf(Date);
    expect(record?.signedAt).toBeInstanceOf(Date);
  });

  it("follows the diver into the record a merge keeps", async () => {
    const ctx = await signedSeat();
    const [survivor] = await ctx.db
      .insert(people)
      // The same name and date as the seat's diver (`courseContext` sets
      // 1990-04-02), so the merge asks for no "two people" acknowledgement.
      .values({ shopId: ctx.shop.id, fullName: ctx.seat.fullName, dateOfBirth: "1990-04-02" })
      .returning();
    if (!survivor) throw new Error("survivor insert failed");
    await ctx.db.insert(personRoles).values({ personId: survivor.id, role: "diver" });

    const preview = await getDiverMergePreview(ctx.db, ctx.shop.id, ctx.seat.personId, survivor.id);
    const merged = await mergeDiverRecords({
      db: ctx.db,
      shopId: ctx.shop.id,
      personId: ctx.seat.personId,
      survivorId: survivor.id,
      actorPersonId: ctx.owner.id,
      acknowledged: preview?.acknowledgement,
    });
    expect(merged.ok ? merged.survivorId : merged.reason).toBe(survivor.id);

    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(record?.personId).toBe(survivor.id);
    // `person_id` is inside the seal, and the merge re-sealed the record over
    // the diver it now belongs to (issue #2266); a bare repoint would not.
    if (!record) throw new Error("record expected");
    expect(verifyCourseFormIntegrity(record)).toBe("valid");
    expect(verifyCourseFormIntegrity({ ...record, personId: ctx.seat.personId })).toBe("invalid");
    // Still satisfied: the booking and the record moved together.
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
  });
});

/** Re-time the seat's session, relative to the real clock the readers use. */
async function retime(
  ctx: Awaited<ReturnType<typeof courseContext>>,
  startDays: number,
  endDays: number,
) {
  const day = 24 * 60 * 60 * 1000;
  await ctx.db
    .update(trips)
    // diveday:allow-flat-revision: a test re-times its own session in a per-test database no calendar has seen.
    .set({
      startsAt: new Date(ctx.now.getTime() + startDays * day),
      endsAt: new Date(ctx.now.getTime() + endDays * day),
    })
    .where(eq(trips.id, ctx.seat.tripId));
}

/** Backdate a form's requirement and its first version to before the session began. */
async function requiredSinceBefore(
  ctx: Awaited<ReturnType<typeof courseContext>>,
  formId: string,
  days: number,
) {
  const at = new Date(ctx.now.getTime() - days * 24 * 60 * 60 * 1000);
  await ctx.db
    .update(courseFormRequirements)
    .set({ createdAt: at })
    .where(eq(courseFormRequirements.formId, formId));
  await ctx.db
    .update(courseFormVersions)
    .set({ createdAt: at })
    .where(eq(courseFormVersions.formId, formId));
}

/**
 * **A session that has started keeps the forms it started with** (ADR
 * 20261008-course-forms). Adversarial: the shop edits a form on day two of a
 * three-day course, adds a form mid-course, and tries to record paper after
 * the course is over.
 */
describe("course forms — mid-course edits (in-memory PGlite)", () => {
  it("keeps a signature on the version in force when a multi-day session began", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await requiredSinceBefore(ctx, form.id, 3);
    // Day two of three: began yesterday, ends tomorrow.
    await retime(ctx, -1, 1);
    expect(
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formVersionId: form.versionId,
        signerName: ctx.seat.fullName,
        agreed: true,
      }),
    ).toMatchObject({ ok: true });
    // The shop edits the form now, mid-course.
    await saveCourseFormVersion(ctx.db, {
      shopId: ctx.shop.id,
      formId: form.id,
      title: form.title,
      body: `${BODY} Edited on day two.`,
      actorPersonId: ctx.staff.id,
    });

    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
    expect(
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.outstanding,
    ).toEqual([]);
    // Other students on the session have not signed; this one is clear.
    expect(
      (await owedCourseFormsByBooking(ctx.db, ctx.shop.id, [ctx.seat.tripId])).has(
        ctx.seat.bookingId,
      ),
    ).toBe(false);
  });

  it("still asks an unsigned student on a started session, who signs the current words", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await requiredSinceBefore(ctx, form.id, 3);
    await retime(ctx, -1, 1);
    await saveCourseFormVersion(ctx.db, {
      shopId: ctx.shop.id,
      formId: form.id,
      title: form.title,
      body: `${BODY} Edited on day two.`,
      actorPersonId: ctx.staff.id,
    });
    const forms = await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    const [owed] = forms?.outstanding ?? [];
    expect(owed).toMatchObject({ formId: form.id, version: 2, alsoAccepted: [form.versionId] });
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).toContain("course_form_unsigned");
  });

  it("does not ask a started session for a form added to the course after it began", async () => {
    const ctx = await courseContext();
    await retime(ctx, -1, 1);
    // Added now, a day after the session began.
    await requireOneForm(ctx);

    expect(
      (await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId))?.required,
    ).toEqual([]);
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
  });

  it("refuses a paper record, and the student's own signature, once the session has ended", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await requiredSinceBefore(ctx, form.id, 5);
    await retime(ctx, -3, -2);

    expect(
      await recordPaperCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formId: form.id,
        recordedByPersonId: ctx.staff.id,
        paperCopyConfirmed: true,
      }),
    ).toEqual({ ok: false, reason: "session_ended" });
    expect(
      await signCourseForm(ctx.db, {
        shopId: ctx.shop.id,
        bookingId: ctx.seat.bookingId,
        formVersionId: form.versionId,
        signerName: ctx.seat.fullName,
        agreed: true,
      }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(await ctx.db.select().from(courseFormRecords)).toEqual([]);
  });

  it("says before a save who a new version would ask again, and who an added form would ask", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    expect((await courseFormResignImpact(ctx.db, ctx.shop.id)).get(form.id)).toBeUndefined();
    await signCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    });
    expect((await courseFormResignImpact(ctx.db, ctx.shop.id)).get(form.id)).toEqual({
      students: 1,
      sessions: 1,
    });
    const enrolled = await courseUpcomingEnrollment(ctx.db, ctx.shop.id, ctx.seat.courseId);
    expect(enrolled.students).toBeGreaterThanOrEqual(1);
    expect(enrolled.sessions).toBeGreaterThanOrEqual(1);
    // Once the session is under way, a new version asks it nothing.
    await retime(ctx, -1, 1);
    expect((await courseFormResignImpact(ctx.db, ctx.shop.id)).get(form.id)).toBeUndefined();
  });
});

describe("course forms — a minor's guardian, and a paper copy's own rules (in-memory PGlite)", () => {
  it("lets a guardian complete a form a minor signed before their date of birth was on file", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    await ctx.db.update(people).set({ dateOfBirth: null }).where(eq(people.id, ctx.seat.personId));
    const student = {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formVersionId: form.versionId,
      signerName: ctx.seat.fullName,
      agreed: true,
    };
    const first = await signCourseForm(ctx.db, student);
    expect(first).toMatchObject({ ok: true, alreadySigned: false });
    // The date of birth arrives after the signature: a minor, signed alone.
    await ctx.db
      .update(people)
      .set({ dateOfBirth: "2013-03-03" })
      .where(eq(people.id, ctx.seat.personId));

    const blocked = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(blocked?.blockers).toContainEqual({
      code: "course_form_guardian_missing",
      params: { formTitle: "Course liability release" },
    });
    const owed = await getCourseFormsForBooking(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(owed?.outstanding.map((row) => row.gap)).toEqual(["guardian_missing"]);
    expect(await signCourseForm(ctx.db, student)).toEqual({
      ok: false,
      reason: "guardian_required",
    });

    const completed = await signCourseForm(ctx.db, {
      ...student,
      guardian: { name: "Rosa Guardian", relationship: "parent", agreed: true },
    });
    expect(completed).toEqual({
      ok: true,
      recordId: first.ok ? first.recordId : "",
      alreadySigned: true,
    });
    const cleared = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(cleared?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_guardian_missing",
    );

    // Filled once: a second guardian never overwrites the first.
    await signCourseForm(ctx.db, {
      ...student,
      guardian: { name: "Someone Later", relationship: "parent", agreed: true },
    });
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.bookingId, ctx.seat.bookingId));
    expect(record).toMatchObject({ signedName: ctx.seat.fullName, guardianName: "Rosa Guardian" });
    // The guardian's half is inside the seal, re-minted when it was written.
    if (!record) throw new Error("record expected");
    expect(verifyCourseFormIntegrity(record)).toBe("valid");
    expect(verifyCourseFormIntegrity({ ...record, guardianName: null })).toBe("invalid");
  });

  it("refuses a paper record on a held seat, without the paper-copy tick, or dated after today", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    const paper = {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formId: form.id,
      recordedByPersonId: ctx.staff.id,
      paperCopyConfirmed: true,
    };
    expect(await recordPaperCourseForm(ctx.db, { ...paper, paperCopyConfirmed: false })).toEqual({
      ok: false,
      reason: "paper_copy_unconfirmed",
    });
    const today = calendarToday(ctx.shop.timezone);
    expect(
      await recordPaperCourseForm(ctx.db, { ...paper, signedOn: shiftCalendarDate(today, 1) }),
    ).toEqual({ ok: false, reason: "invalid_date" });
    expect(await recordPaperCourseForm(ctx.db, { ...paper, signedOn: "2026-02-30" })).toEqual({
      ok: false,
      reason: "invalid_date",
    });
    await ctx.db
      .update(bookings)
      .set({ identityUnconfirmedAt: ctx.now })
      .where(eq(bookings.id, ctx.seat.bookingId));
    expect(await recordPaperCourseForm(ctx.db, paper)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await ctx.db.select().from(courseFormRecords)).toEqual([]);
  });

  it("measures a paper copy's signer on the date written on it", async () => {
    const ctx = await courseContext();
    const form = await requireOneForm(ctx);
    const today = calendarToday(ctx.shop.timezone);
    // Eighteen two days ago; the paper is dated five days ago, when they were not.
    const birthday = shiftCalendarDateMonths(shiftCalendarDate(today, -2), -18 * 12);
    await ctx.db
      .update(people)
      .set({ dateOfBirth: birthday })
      .where(eq(people.id, ctx.seat.personId));
    const paper = {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formId: form.id,
      recordedByPersonId: ctx.staff.id,
      paperCopyConfirmed: true,
      signedOn: shiftCalendarDate(today, -5),
    };
    expect(await recordPaperCourseForm(ctx.db, paper)).toEqual({
      ok: false,
      reason: "guardian_required",
    });
    expect(
      await recordPaperCourseForm(ctx.db, {
        ...paper,
        guardian: { name: "Rosa Guardian", relationship: "parent" },
      }),
    ).toMatchObject({ ok: true });
    const [record] = await ctx.db
      .select()
      .from(courseFormRecords)
      .where(eq(courseFormRecords.bookingId, ctx.seat.bookingId));
    expect(record?.paperSignedOn).toBe(paper.signedOn);
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_guardian_missing",
    );
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

function calendarToday(timezone: string) {
  return calendarDateInTimezone(nowDate(), timezone);
}
