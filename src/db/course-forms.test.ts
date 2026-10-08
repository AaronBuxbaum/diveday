import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { courseTemplateSnapshot, getCourseTemplate } from "@/content/course-templates";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import type { AppDb } from "./client";
import {
  attachStandardCourseForms,
  courseFormsAwaitingTextByCourse,
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
import { bookings, courseFormRecords, courses, people, personRoles, shops, trips } from "./schema";
import { listStaff } from "./trips";

const BODY =
  "I understand the course's in-water sessions follow the instructor's plan, and I will tell the instructor before any session if anything about my health changes.";

/** A seeded upcoming course session with a live seat on it, and a staffer. */
async function courseContext() {
  const { db, shop } = await seededShopContext();
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
    const { db, shop } = await seededShopContext();
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

  it("sets the forms up again when a template sync runs, adding what the shop took off", async () => {
    const { db, shop } = await seededShopContext();
    const openWater = await getCourseBySlug(db, shop.id, "open-water-diver");
    const template = getCourseTemplate("open-water-diver");
    if (!openWater || !template) throw new Error("seeded Open Water missing");
    await setCourseFormRequirements(db, { shopId: shop.id, courseId: openWater.id, formIds: [] });
    // An older template baseline, so there is an update to pull.
    await db
      .update(courses)
      .set({
        sourceTemplateVersion: 1,
        sourceTemplateSnapshot: { ...courseTemplateSnapshot(template), summary: "Older words" },
      })
      .where(eq(courses.id, openWater.id));
    const pulled = await pullCourseTemplateUpdates(
      db,
      shop.id,
      openWater.id,
      "preserve-shop-edits",
    );
    expect(pulled.status).toBe("updated");
    expect(await listCourseFormRequirements(db, shop.id, openWater.id)).toHaveLength(
      template.standardForms?.length ?? 0,
    );
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
      }),
    ).toEqual({ ok: false, reason: "staff_not_found" });

    const outcome = await recordPaperCourseForm(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.seat.bookingId,
      formId: form.id,
      recordedByPersonId: ctx.staff.id,
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
      .select({ personId: courseFormRecords.personId })
      .from(courseFormRecords)
      .where(eq(courseFormRecords.id, ctx.recordId));
    expect(record?.personId).toBe(survivor.id);
    // Still satisfied: the booking and the record moved together.
    const readiness = await getBookingReadiness(ctx.db, ctx.shop.id, ctx.seat.bookingId);
    expect(readiness?.blockers.map((blocker) => blocker.code)).not.toContain(
      "course_form_unsigned",
    );
  });
});
