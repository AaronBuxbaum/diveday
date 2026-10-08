import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  type CourseFormSignature,
  courseFormAwaitingText,
  courseFormTextChanged,
  normalizeCourseFormText,
  outstandingCourseForms,
  type RequiredCourseForm,
} from "@/lib/course-forms";
import {
  type GuardianRelationship,
  guardianSignatureRequired,
  isGuardianRelationship,
  signingDate,
} from "@/lib/guardian";
import { personNamesMatch } from "@/lib/person-name";
import {
  inPersonAttestationProvider,
  localTypedConsentProvider,
  namesakeAttestationProvider,
} from "@/lib/signatures";
import { hasReturned } from "@/lib/trips";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import {
  bookings,
  courseFormRecords,
  courseFormRequirements,
  courseForms,
  courseFormVersions,
  courses,
  people,
  shops,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Course forms**, the stateful half (ADR 20261008-course-forms). The rule
 * for "which forms does this enrollment still owe" is `src/lib/course-forms.ts`;
 * this module reads the rows that rule weighs and writes the four tables.
 *
 * Every read and write is scoped by the caller's `shopId`, and every id that
 * arrives from a form (a form, a course, a version) is re-proven against that
 * shop before it is written beside anything else — a form id copied from
 * another shop resolves to nothing.
 */

/** A live form with its current words, for the editor and the course's picker. */
export type CourseFormSummary = {
  id: string;
  title: string;
  body: string;
  version: number;
  versionId: string;
  updatedAt: Date;
};

/** Every live form of a shop with its current version, oldest first. */
export async function listCourseForms(
  db: DbExecutor,
  shopId: string,
): Promise<CourseFormSummary[]> {
  const rows = await db
    .select({
      id: courseForms.id,
      createdAt: courseForms.createdAt,
      versionId: courseFormVersions.id,
      version: courseFormVersions.version,
      title: courseFormVersions.title,
      body: courseFormVersions.body,
      versionCreatedAt: courseFormVersions.createdAt,
    })
    .from(courseForms)
    .innerJoin(courseFormVersions, eq(courseFormVersions.formId, courseForms.id))
    .where(
      and(
        eq(courseForms.shopId, shopId),
        eq(courseFormVersions.shopId, shopId),
        isNull(courseForms.deletedAt),
      ),
    )
    .orderBy(asc(courseForms.createdAt), asc(courseForms.id), desc(courseFormVersions.version));
  const current = new Map<string, CourseFormSummary>();
  for (const row of rows) {
    if (current.has(row.id)) continue;
    current.set(row.id, {
      id: row.id,
      title: row.title,
      body: row.body,
      version: row.version,
      versionId: row.versionId,
      updatedAt: row.versionCreatedAt,
    });
  }
  return [...current.values()];
}

/** A new form, at version 1. */
export async function createCourseForm(
  db: AppDb,
  input: { shopId: string; title: string; body: string; actorPersonId: string },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .insert(courseForms)
      .values({ shopId: input.shopId })
      .returning({ id: courseForms.id });
    if (!form) throw new Error("createCourseForm: insert returned no row");
    await tx.insert(courseFormVersions).values({
      shopId: input.shopId,
      formId: form.id,
      version: 1,
      title: normalizeCourseFormText(input.title),
      body: normalizeCourseFormText(input.body),
      createdByPersonId: input.actorPersonId,
    });
    return { id: form.id };
  });
}

export type SaveCourseFormOutcome =
  | { ok: true; versioned: boolean }
  | { ok: false; reason: "not_found" };

/**
 * New words for a form: a new version, inserted, never an update — every
 * record already signed keeps the words it was signed against, and every
 * student enrolled from here on signs these. The same words again write
 * nothing, because a new version asks every student to sign again.
 */
export async function saveCourseFormVersion(
  db: AppDb,
  input: { shopId: string; formId: string; title: string; body: string; actorPersonId: string },
): Promise<SaveCourseFormOutcome> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select({ id: courseForms.id })
      .from(courseForms)
      .where(
        and(
          eq(courseForms.id, input.formId),
          eq(courseForms.shopId, input.shopId),
          isNull(courseForms.deletedAt),
        ),
      )
      // Two editors saving at once must not both claim the next number.
      .for("update");
    if (!form) return { ok: false, reason: "not_found" } as const;
    const [current] = await tx
      .select()
      .from(courseFormVersions)
      .where(
        and(eq(courseFormVersions.formId, form.id), eq(courseFormVersions.shopId, input.shopId)),
      )
      .orderBy(desc(courseFormVersions.version))
      .limit(1);
    const next = {
      title: normalizeCourseFormText(input.title),
      body: normalizeCourseFormText(input.body),
    };
    if (current && !courseFormTextChanged(current, next)) {
      return { ok: true, versioned: false } as const;
    }
    await tx.insert(courseFormVersions).values({
      shopId: input.shopId,
      formId: form.id,
      version: (current?.version ?? 0) + 1,
      title: next.title,
      body: next.body,
      createdByPersonId: input.actorPersonId,
    });
    return { ok: true, versioned: true } as const;
  });
}

/**
 * Delete a form (soft, ADR 20260820-every-delete-is-soft). Every course that
 * listed it stops asking for it in the same transaction; signed records keep
 * their snapshot and stay on file.
 */
export async function deleteCourseForm(
  db: AppDb,
  input: { shopId: string; formId: string; now?: Date },
): Promise<boolean> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .update(courseForms)
      .set({ deletedAt: now })
      .where(
        and(
          eq(courseForms.id, input.formId),
          eq(courseForms.shopId, input.shopId),
          isNull(courseForms.deletedAt),
        ),
      )
      .returning({ id: courseForms.id });
    if (!deleted) return false;
    await tx
      .update(courseFormRequirements)
      .set({ deletedAt: now })
      .where(
        and(
          eq(courseFormRequirements.formId, deleted.id),
          eq(courseFormRequirements.shopId, input.shopId),
          isNull(courseFormRequirements.deletedAt),
        ),
      );
    return true;
  });
}

/** The live form ids a course requires, in order. */
export async function listCourseFormRequirements(
  db: DbExecutor,
  shopId: string,
  courseId: string,
): Promise<string[]> {
  const rows = await db
    .select({ formId: courseFormRequirements.formId })
    .from(courseFormRequirements)
    .innerJoin(courseForms, eq(courseForms.id, courseFormRequirements.formId))
    .where(
      and(
        eq(courseFormRequirements.shopId, shopId),
        eq(courseFormRequirements.courseId, courseId),
        isNull(courseFormRequirements.deletedAt),
        eq(courseForms.shopId, shopId),
        isNull(courseForms.deletedAt),
      ),
    )
    .orderBy(asc(courseFormRequirements.position), asc(courseFormRequirements.createdAt));
  return rows.map((row) => row.formId);
}

/**
 * Set the forms a course requires, in the order given. Ids that are not one
 * of this shop's live forms are refused as a whole rather than dropped — a
 * list the shop did not mean is worse than no change. A form taken off the
 * list is soft-deleted from it; one still on it keeps its row and takes its
 * new position.
 */
export async function setCourseFormRequirements(
  db: AppDb,
  input: { shopId: string; courseId: string; formIds: readonly string[]; now?: Date },
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "unknown_form" }> {
  const now = input.now ?? nowDate();
  const formIds = [...new Set(input.formIds)];
  return db.transaction(async (tx) => {
    const [course] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, input.courseId), eq(courses.shopId, input.shopId)))
      .for("update");
    if (!course) return { ok: false, reason: "not_found" } as const;
    if (formIds.length > 0) {
      const live = await tx
        .select({ id: courseForms.id })
        .from(courseForms)
        .where(
          and(
            eq(courseForms.shopId, input.shopId),
            inArray(courseForms.id, formIds),
            isNull(courseForms.deletedAt),
          ),
        );
      if (live.length !== formIds.length) return { ok: false, reason: "unknown_form" } as const;
    }
    const existing = await tx
      .select({ id: courseFormRequirements.id, formId: courseFormRequirements.formId })
      .from(courseFormRequirements)
      .where(
        and(
          eq(courseFormRequirements.shopId, input.shopId),
          eq(courseFormRequirements.courseId, course.id),
          isNull(courseFormRequirements.deletedAt),
        ),
      );
    const keep = new Set(formIds);
    const dropped = existing.filter((row) => !keep.has(row.formId)).map((row) => row.id);
    if (dropped.length > 0) {
      await tx
        .update(courseFormRequirements)
        .set({ deletedAt: now })
        .where(inArray(courseFormRequirements.id, dropped));
    }
    const byForm = new Map(existing.map((row) => [row.formId, row.id]));
    for (const [position, formId] of formIds.entries()) {
      const id = byForm.get(formId);
      if (id) {
        await tx
          .update(courseFormRequirements)
          .set({ position })
          .where(eq(courseFormRequirements.id, id));
      } else {
        await tx
          .insert(courseFormRequirements)
          .values({ shopId: input.shopId, courseId: course.id, formId, position });
      }
    }
    return { ok: true } as const;
  });
}

/**
 * **The agency's standard forms, set up for a course made from a template**
 * (ADR 20261008-course-forms). `titles` is the template's `standardForms`.
 *
 * Each title the shop has no live form for becomes a new form with that title
 * and an empty body — DiveDay ships the agency's titles, never its words
 * (H-10) — and each listed form the course does not already ask for is added
 * to the end of its list. A form the shop already has, matched by title, is
 * reused as it stands, text and all. Nothing is ever removed or reordered: a
 * template sync adds what is missing and leaves the shop's choices alone.
 *
 * An empty form is asked of nobody (`courseFormAwaitingText`), so attaching
 * one changes no student's readiness until the shop pastes its text in.
 *
 * Callers run it in the transaction that created or synced the course. The
 * shop row is locked first, so two courses synced at once cannot both create
 * the same title.
 */
export async function attachStandardCourseForms(
  db: DbExecutor,
  input: { shopId: string; courseId: string; titles: readonly string[] },
): Promise<{ created: number; attached: number }> {
  const titles = [...new Set(input.titles.map(normalizeCourseFormText))].filter(
    (title) => title !== "",
  );
  if (titles.length === 0) return { created: 0, attached: 0 };
  const [shop] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .for("update");
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, input.courseId), eq(courses.shopId, input.shopId)));
  if (!shop || !course) return { created: 0, attached: 0 };

  const titleKey = (title: string) => normalizeCourseFormText(title).toLocaleLowerCase("en-US");
  const formByTitle = new Map(
    (await listCourseForms(db, input.shopId)).map((form) => [titleKey(form.title), form.id]),
  );
  const current = await db
    .select({
      formId: courseFormRequirements.formId,
      position: courseFormRequirements.position,
    })
    .from(courseFormRequirements)
    .where(
      and(
        eq(courseFormRequirements.shopId, input.shopId),
        eq(courseFormRequirements.courseId, course.id),
        isNull(courseFormRequirements.deletedAt),
      ),
    );
  const required = new Set(current.map((row) => row.formId));
  let position = current.reduce((max, row) => Math.max(max, row.position + 1), 0);
  let created = 0;
  let attached = 0;
  for (const title of titles) {
    let formId = formByTitle.get(titleKey(title));
    if (!formId) {
      const [form] = await db
        .insert(courseForms)
        .values({ shopId: input.shopId })
        .returning({ id: courseForms.id });
      if (!form) throw new Error("attachStandardCourseForms: insert returned no row");
      await db.insert(courseFormVersions).values({
        shopId: input.shopId,
        formId: form.id,
        version: 1,
        title,
        body: "",
        createdByPersonId: null,
      });
      formId = form.id;
      formByTitle.set(titleKey(title), formId);
      created += 1;
    }
    if (required.has(formId)) continue;
    await db
      .insert(courseFormRequirements)
      .values({ shopId: input.shopId, courseId: course.id, formId, position });
    required.add(formId);
    position += 1;
    attached += 1;
  }
  return { created, attached };
}

/**
 * The forms a course asks for that are still waiting for the shop's text, by
 * course, in the course's order. The prompt to paste the agency's wording in
 * reads this; nothing that decides readiness does.
 */
export async function courseFormsAwaitingTextByCourse(
  db: DbExecutor,
  shopId: string,
  courseIds: readonly string[],
): Promise<Map<string, { formId: string; title: string }[]>> {
  const result = new Map<string, { formId: string; title: string }[]>();
  if (courseIds.length === 0) return result;
  const rows = await db
    .select({
      courseId: courseFormRequirements.courseId,
      formId: courseForms.id,
      title: courseFormVersions.title,
      body: courseFormVersions.body,
    })
    .from(courseFormRequirements)
    .innerJoin(courseForms, eq(courseForms.id, courseFormRequirements.formId))
    .innerJoin(courseFormVersions, eq(courseFormVersions.formId, courseForms.id))
    .where(
      and(
        eq(courseFormRequirements.shopId, shopId),
        inArray(courseFormRequirements.courseId, [...courseIds]),
        isNull(courseFormRequirements.deletedAt),
        eq(courseForms.shopId, shopId),
        isNull(courseForms.deletedAt),
        eq(courseFormVersions.shopId, shopId),
      ),
    )
    .orderBy(
      asc(courseFormRequirements.position),
      asc(courseForms.id),
      desc(courseFormVersions.version),
    );
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.courseId}:${row.formId}`;
    // The first row per (course, form) is the current version.
    if (seen.has(key)) continue;
    seen.add(key);
    if (!courseFormAwaitingText(row.body)) continue;
    const list = result.get(row.courseId) ?? [];
    list.push({ formId: row.formId, title: row.title });
    result.set(row.courseId, list);
  }
  return result;
}

/**
 * The forms each trip's course requires, at their current version, keyed by
 * trip. A trip with no course, or a course that asks for none, is absent. A
 * form still waiting for the shop's text is asked of nobody, so it is absent
 * too — which is what keeps it from being signed, sent, owed or blocking.
 */
export async function requiredCourseFormsForTrips(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, RequiredCourseForm[]>> {
  const result = new Map<string, RequiredCourseForm[]>();
  if (tripIds.length === 0) return result;
  const rows = await db
    .select({
      tripId: trips.id,
      formId: courseForms.id,
      position: courseFormRequirements.position,
      versionId: courseFormVersions.id,
      version: courseFormVersions.version,
      title: courseFormVersions.title,
      body: courseFormVersions.body,
    })
    .from(trips)
    .innerJoin(courseFormRequirements, eq(courseFormRequirements.courseId, trips.courseId))
    .innerJoin(courseForms, eq(courseForms.id, courseFormRequirements.formId))
    .innerJoin(courseFormVersions, eq(courseFormVersions.formId, courseForms.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        inArray(trips.id, [...tripIds]),
        liveTrip(),
        eq(courseFormRequirements.shopId, shopId),
        isNull(courseFormRequirements.deletedAt),
        eq(courseForms.shopId, shopId),
        isNull(courseForms.deletedAt),
        eq(courseFormVersions.shopId, shopId),
      ),
    )
    .orderBy(asc(courseFormRequirements.position), desc(courseFormVersions.version));
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.tripId}:${row.formId}`;
    // The first row per (trip, form) is the highest version: the current text.
    if (seen.has(key)) continue;
    seen.add(key);
    if (courseFormAwaitingText(row.body)) continue;
    const list = result.get(row.tripId) ?? [];
    list.push({
      shopId,
      formId: row.formId,
      versionId: row.versionId,
      version: row.version,
      title: row.title,
      position: row.position,
    });
    result.set(row.tripId, list);
  }
  return result;
}

/** Every course-form signature on these bookings, at this shop. */
export async function courseFormSignaturesForBookings(
  db: DbExecutor,
  shopId: string,
  bookingIds: readonly string[],
): Promise<CourseFormSignature[]> {
  if (bookingIds.length === 0) return [];
  return db
    .select({
      shopId: courseFormRecords.shopId,
      bookingId: courseFormRecords.bookingId,
      personId: courseFormRecords.personId,
      formVersionId: courseFormRecords.formVersionId,
      signedAt: courseFormRecords.signedAt,
      guardianSignedAt: courseFormRecords.guardianSignedAt,
    })
    .from(courseFormRecords)
    .where(
      and(
        eq(courseFormRecords.shopId, shopId),
        inArray(courseFormRecords.bookingId, [...bookingIds]),
      ),
    );
}

/** One booking's enrollment, as the signing page and the writers need it. */
type Enrollment = {
  bookingId: string;
  personId: string;
  fullName: string;
  dateOfBirth: string | null;
  identityHeld: boolean;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
};

async function enrollmentFor(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<Enrollment | null> {
  const [row] = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      fullName: people.fullName,
      dateOfBirth: people.dateOfBirth,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
        eq(people.shopId, shopId),
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    bookingId: row.bookingId,
    personId: row.personId,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth,
    identityHeld: row.identityUnconfirmedAt !== null,
    tripId: row.tripId,
    tripTitle: row.tripTitle,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timezone: row.timezone,
  };
}

/** A form as the student reads it: the current words, ready to sign. */
export type CourseFormToSign = RequiredCourseForm & { body: string };

export type CourseFormsForBooking = {
  enrollment: Enrollment;
  /** Every form the course requires, in order. */
  required: RequiredCourseForm[];
  /** The ones this enrollment still owes, in order, with their words. */
  outstanding: CourseFormToSign[];
};

/**
 * What a student owes on one enrollment, for the signing page and the staff
 * surfaces that offer a paper record. Null when the booking is not a live
 * seat of this shop.
 */
export async function getCourseFormsForBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<CourseFormsForBooking | null> {
  const enrollment = await enrollmentFor(db, shopId, bookingId);
  if (!enrollment) return null;
  const required =
    (await requiredCourseFormsForTrips(db, shopId, [enrollment.tripId])).get(enrollment.tripId) ??
    [];
  if (required.length === 0) return { enrollment, required, outstanding: [] };
  const signatures = await courseFormSignaturesForBookings(db, shopId, [bookingId]);
  const owed = outstandingCourseForms({
    shopId,
    bookingId,
    personId: enrollment.personId,
    required,
    signatures,
    signer: { dateOfBirth: enrollment.dateOfBirth, timezone: enrollment.timezone },
  });
  if (owed.length === 0) return { enrollment, required, outstanding: [] };
  const bodies = await db
    .select({ id: courseFormVersions.id, body: courseFormVersions.body })
    .from(courseFormVersions)
    .where(
      and(
        eq(courseFormVersions.shopId, shopId),
        inArray(
          courseFormVersions.id,
          owed.map((form) => form.versionId),
        ),
      ),
    );
  const bodyById = new Map(bodies.map((row) => [row.id, row.body]));
  return {
    enrollment,
    required,
    outstanding: owed.map((form) => ({ ...form, body: bodyById.get(form.versionId) ?? "" })),
  };
}

/** The guardian's half of a minor's form, as the page collects it. */
export type CourseFormGuardianInput = {
  name: string;
  relationship: string;
  agreed: boolean;
};

export type SignCourseFormOutcome =
  | { ok: true; recordId: string; alreadySigned: boolean }
  | {
      ok: false;
      reason: /** Not a live seat of this shop, a held seat, or a course that has finished. */
        | "unavailable"
        /** The version the page showed is no longer the one the course asks for. */
        | "version_changed"
        | "invalid_signature"
        | "name_mismatch"
        | "guardian_required"
        | "guardian_invalid";
    };

/** The current required version this id names for this enrollment, or null. */
function requiredVersion(
  required: readonly RequiredCourseForm[],
  formVersionId: string,
): RequiredCourseForm | null {
  return required.find((form) => form.versionId === formVersionId) ?? null;
}

/**
 * **A student signs one form on their own link.** The caller has already
 * proven the bearer owns `bookingId` (a verified `readiness` capability).
 *
 * The typed name must be the student's own, as the release's is
 * (`completeWaiver`); a minor's form takes a guardian's signature beside it
 * under the release's own rules, including the refusal of a co-signer typed
 * under the student's own name. A version that is no longer current is
 * refused rather than signed, so nobody puts their name to words the course
 * no longer asks for. Idempotent per enrollment and version.
 */
export async function signCourseForm(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    formVersionId: string;
    signerName: string;
    agreed: boolean;
    guardian?: CourseFormGuardianInput;
    now?: Date;
  },
): Promise<SignCourseFormOutcome> {
  const now = input.now ?? nowDate();
  const evidence = localTypedConsentProvider.capture({
    signerName: input.signerName,
    agreed: input.agreed,
    signedAt: now,
  });
  if (!evidence) return { ok: false, reason: "invalid_signature" };
  return db.transaction(async (tx): Promise<SignCourseFormOutcome> => {
    const enrollment = await enrollmentFor(tx, input.shopId, input.bookingId);
    if (!enrollment || enrollment.identityHeld || hasReturned(enrollment.endsAt, now)) {
      return { ok: false, reason: "unavailable" };
    }
    const required =
      (await requiredCourseFormsForTrips(tx, input.shopId, [enrollment.tripId])).get(
        enrollment.tripId,
      ) ?? [];
    const form = requiredVersion(required, input.formVersionId);
    if (!form) return { ok: false, reason: "version_changed" };
    if (!personNamesMatch(evidence.signerName, enrollment.fullName)) {
      return { ok: false, reason: "name_mismatch" };
    }
    let guardian: {
      name: string;
      relationship: GuardianRelationship;
      method: string;
      consentedAt: Date;
      signedAt: Date;
    } | null = null;
    if (guardianSignatureRequired(enrollment.dateOfBirth, signingDate(now, enrollment.timezone))) {
      if (!input.guardian) return { ok: false, reason: "guardian_required" };
      const co = localTypedConsentProvider.capture({
        signerName: input.guardian.name,
        agreed: input.guardian.agreed,
        signedAt: now,
      });
      // The online path has no namesake exception (ADR
      // 20260907-guardian-co-signature): a co-signer typed under the
      // student's own name is one signature wearing two hats.
      if (
        !co ||
        !isGuardianRelationship(input.guardian.relationship) ||
        personNamesMatch(co.signerName, enrollment.fullName)
      ) {
        return { ok: false, reason: "guardian_invalid" };
      }
      guardian = {
        name: co.signerName,
        relationship: input.guardian.relationship,
        method: co.method,
        consentedAt: co.consentedAt,
        signedAt: co.signedAt,
      };
    }
    return insertRecord(tx, {
      shopId: input.shopId,
      enrollment,
      form,
      signedName: evidence.signerName,
      method: evidence.method,
      recordedByPersonId: null,
      consentedAt: evidence.consentedAt,
      signedAt: evidence.signedAt,
      guardian,
    });
  });
}

async function insertRecord(
  tx: DbExecutor,
  input: {
    shopId: string;
    enrollment: Enrollment;
    form: RequiredCourseForm;
    signedName: string;
    method: string;
    recordedByPersonId: string | null;
    consentedAt: Date;
    signedAt: Date;
    guardian: {
      name: string;
      relationship: GuardianRelationship;
      method: string;
      consentedAt: Date;
      signedAt: Date;
    } | null;
  },
): Promise<SignCourseFormOutcome> {
  const [version] = await tx
    .select()
    .from(courseFormVersions)
    .where(
      and(
        eq(courseFormVersions.id, input.form.versionId),
        eq(courseFormVersions.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!version) return { ok: false, reason: "version_changed" };
  const [record] = await tx
    .insert(courseFormRecords)
    .values({
      shopId: input.shopId,
      bookingId: input.enrollment.bookingId,
      personId: input.enrollment.personId,
      formId: version.formId,
      formVersionId: version.id,
      formTitle: version.title,
      formVersion: version.version,
      formBody: version.body,
      signedName: input.signedName,
      signatureMethod: input.method,
      recordedByPersonId: input.recordedByPersonId,
      consentedAt: input.consentedAt,
      signedAt: input.signedAt,
      ...(input.guardian
        ? {
            guardianName: input.guardian.name,
            guardianRelationship: input.guardian.relationship,
            guardianSignatureMethod: input.guardian.method,
            guardianConsentedAt: input.guardian.consentedAt,
            guardianSignedAt: input.guardian.signedAt,
          }
        : {}),
    })
    .onConflictDoNothing({
      target: [courseFormRecords.bookingId, courseFormRecords.formVersionId],
    })
    .returning({ id: courseFormRecords.id });
  if (record) return { ok: true, recordId: record.id, alreadySigned: false };
  const [standing] = await tx
    .select({ id: courseFormRecords.id })
    .from(courseFormRecords)
    .where(
      and(
        eq(courseFormRecords.bookingId, input.enrollment.bookingId),
        eq(courseFormRecords.formVersionId, version.id),
        eq(courseFormRecords.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!standing) throw new Error("course form record conflict without a standing row");
  return { ok: true, recordId: standing.id, alreadySigned: true };
}

export type PaperCourseFormOutcome =
  | SignCourseFormOutcome
  | { ok: false; reason: "staff_not_found" | "guardian_name_matches_diver" };

/**
 * **A staffer records a form the student signed on paper**, the same shape as
 * a paper release (`recordInPersonWaiver`): the record snapshots the form's
 * current words, is marked `in_person_attested`, and names the staffer who
 * recorded it. A minor's paper form names the guardian who co-signed it, and
 * the release's namesake rule applies unchanged — a co-signer whose name
 * reads as the student's is refused unless the staffer ticks that they watched
 * two people sign.
 */
export async function recordPaperCourseForm(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    formId: string;
    recordedByPersonId: string;
    guardian?: { name: string; relationship: string; namesakeAttested?: boolean };
    now?: Date;
  },
): Promise<PaperCourseFormOutcome> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx): Promise<PaperCourseFormOutcome> => {
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.recordedByPersonId);
    if (!roles || !isStaff(roles)) return { ok: false, reason: "staff_not_found" };
    const enrollment = await enrollmentFor(tx, input.shopId, input.bookingId);
    if (!enrollment) return { ok: false, reason: "unavailable" };
    const required =
      (await requiredCourseFormsForTrips(tx, input.shopId, [enrollment.tripId])).get(
        enrollment.tripId,
      ) ?? [];
    const form = required.find((candidate) => candidate.formId === input.formId);
    if (!form) return { ok: false, reason: "version_changed" };
    const evidence = inPersonAttestationProvider.capture({
      signerName: enrollment.fullName,
      agreed: true,
      signedAt: now,
    });
    if (!evidence) return { ok: false, reason: "invalid_signature" };
    let guardian: {
      name: string;
      relationship: GuardianRelationship;
      method: string;
      consentedAt: Date;
      signedAt: Date;
    } | null = null;
    if (guardianSignatureRequired(enrollment.dateOfBirth, signingDate(now, enrollment.timezone))) {
      if (!input.guardian) return { ok: false, reason: "guardian_required" };
      let co = inPersonAttestationProvider.capture({
        signerName: input.guardian.name,
        agreed: true,
        signedAt: now,
      });
      if (!co || !isGuardianRelationship(input.guardian.relationship)) {
        return { ok: false, reason: "guardian_invalid" };
      }
      if (personNamesMatch(co.signerName, enrollment.fullName)) {
        if (input.guardian.namesakeAttested !== true) {
          return { ok: false, reason: "guardian_name_matches_diver" };
        }
        co = namesakeAttestationProvider.capture({
          signerName: input.guardian.name,
          agreed: true,
          signedAt: now,
        });
        if (!co) return { ok: false, reason: "guardian_invalid" };
      }
      guardian = {
        name: co.signerName,
        relationship: input.guardian.relationship,
        method: co.method,
        consentedAt: co.consentedAt,
        signedAt: co.signedAt,
      };
    }
    return insertRecord(tx, {
      shopId: input.shopId,
      enrollment,
      form,
      signedName: evidence.signerName,
      method: evidence.method,
      recordedByPersonId: input.recordedByPersonId,
      consentedAt: evidence.consentedAt,
      signedAt: evidence.signedAt,
      guardian,
    });
  });
}

/**
 * Which forms each booking on these trips still owes, by booking id — the
 * course roster's and the trip roster's view, read whatever
 * `COURSE_FORMS_BLOCK_BOARDING` says, so a shop sees what is owed even when
 * it does not block.
 */
export async function owedCourseFormsByBooking(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, RequiredCourseForm[]>> {
  const result = new Map<string, RequiredCourseForm[]>();
  const requiredByTrip = await requiredCourseFormsForTrips(db, shopId, tripIds);
  if (requiredByTrip.size === 0) return result;
  const seats = await db
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      tripId: bookings.tripId,
      dateOfBirth: people.dateOfBirth,
      timezone: shops.timezone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, [...requiredByTrip.keys()]),
        ne(bookings.status, "cancelled"),
      ),
    );
  const signatures = await courseFormSignaturesForBookings(
    db,
    shopId,
    seats.map((seat) => seat.bookingId),
  );
  for (const seat of seats) {
    const owed = outstandingCourseForms({
      shopId,
      bookingId: seat.bookingId,
      personId: seat.personId,
      required: requiredByTrip.get(seat.tripId) ?? [],
      signatures,
      signer: { dateOfBirth: seat.dateOfBirth, timezone: seat.timezone },
    });
    if (owed.length > 0) result.set(seat.bookingId, owed);
  }
  return result;
}
