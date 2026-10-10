import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  COURSE_FORM_INTEGRITY_VERSION_SIGNED,
  courseFormSeal,
  verifyCourseFormIntegrity,
} from "@/lib/course-form-integrity";
import {
  type CourseFormContext,
  type CourseFormGap,
  type CourseFormSignature,
  courseFormAwaitingText,
  courseFormGaps,
  courseFormTextChanged,
  fillCourseFormText,
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
import { verifyBookingCapability } from "./booking-capabilities";
import type { AppDb, DbExecutor } from "./client";
import {
  bookings,
  courseFormRecords,
  courseFormRequirements,
  courseForms,
  courseFormVersions,
  courses,
  people,
  personRoles,
  shops,
  tripAssignments,
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
 * reused as it stands, text and all. Nothing is ever removed or reordered.
 *
 * **A sync never undoes the shop's no.** A form this course once asked for
 * and the shop took off its list (a soft-deleted requirement) stays off. And
 * `offeredBefore` — the titles the course's previous template version named
 * (`sourceTemplateSnapshot.standardForms`) — are skipped outright: the shop
 * already had each of those, so one missing now is one the shop removed or
 * deleted. Only a form new in this template version is set up.
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
  input: {
    shopId: string;
    courseId: string;
    titles: readonly string[];
    offeredBefore?: readonly string[];
  },
): Promise<{ created: number; attached: number }> {
  const titleKey = (title: string) => normalizeCourseFormText(title).toLocaleLowerCase("en-US");
  const offeredBefore = new Set((input.offeredBefore ?? []).map(titleKey));
  const titles = [...new Set(input.titles.map(normalizeCourseFormText))].filter(
    (title) => title !== "" && !offeredBefore.has(titleKey(title)),
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
  // Every form this course ever listed and the shop took off: the shop's no.
  const declined = new Set(
    (
      await db
        .select({ formId: courseFormRequirements.formId })
        .from(courseFormRequirements)
        .where(
          and(
            eq(courseFormRequirements.shopId, input.shopId),
            eq(courseFormRequirements.courseId, course.id),
            isNotNull(courseFormRequirements.deletedAt),
          ),
        )
    ).map((row) => row.formId),
  );
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
    if (required.has(formId) || declined.has(formId)) continue;
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
 * The forms each trip's course requires, keyed by trip. A trip with no course,
 * or a course that asks for none, is absent. A form still waiting for the
 * shop's text is asked of nobody, so it is absent too — which is what keeps it
 * from being signed, sent, owed or blocking.
 *
 * **A session that has started keeps the forms it started with** (ADR
 * 20261008-course-forms). Once `startsAt` has passed, a form added to the
 * course afterwards is not asked of that session, and a signature on the
 * version that was current when it started still counts (`alsoAccepted`) —
 * an edit made on day two of a three-day course asks the next session to
 * sign, never the students already in the water. A session that has not
 * started asks for the current list at the current version.
 */
export async function requiredCourseFormsForTrips(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
  now: Date = nowDate(),
): Promise<Map<string, RequiredCourseForm[]>> {
  const result = new Map<string, RequiredCourseForm[]>();
  if (tripIds.length === 0) return result;
  const rows = await db
    .select({
      tripId: trips.id,
      startsAt: trips.startsAt,
      formId: courseForms.id,
      position: courseFormRequirements.position,
      requiredSince: courseFormRequirements.createdAt,
      versionId: courseFormVersions.id,
      version: courseFormVersions.version,
      versionCreatedAt: courseFormVersions.createdAt,
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
  // Every version of each (trip, form), newest first.
  const versionsByKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.tripId}:${row.formId}`;
    const list = versionsByKey.get(key) ?? [];
    list.push(row);
    versionsByKey.set(key, list);
  }
  for (const versions of versionsByKey.values()) {
    const [current] = versions;
    if (!current) continue;
    const started = current.startsAt <= now;
    let asked = courseFormAwaitingText(current.body) ? null : current;
    const alsoAccepted: string[] = [];
    if (started) {
      // Added after the session began: the session never agreed to ask it.
      if (current.requiredSince > current.startsAt) continue;
      const atStart = versions.find((row) => row.versionCreatedAt <= current.startsAt);
      // No words yet when the session began: nothing was asked then either.
      if (!atStart || courseFormAwaitingText(atStart.body)) continue;
      if (!asked) asked = atStart;
      if (atStart.versionId !== asked.versionId) alsoAccepted.push(atStart.versionId);
    }
    if (!asked) continue;
    const list = result.get(current.tripId) ?? [];
    list.push({
      shopId,
      formId: asked.formId,
      versionId: asked.versionId,
      version: asked.version,
      title: asked.title,
      position: current.position,
      ...(alsoAccepted.length > 0 ? { alsoAccepted } : {}),
    });
    result.set(current.tripId, list);
  }
  for (const list of result.values()) list.sort((a, b) => a.position - b.position);
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
      paperSignedOn: courseFormRecords.paperSignedOn,
    })
    .from(courseFormRecords)
    .where(
      and(
        eq(courseFormRecords.shopId, shopId),
        inArray(courseFormRecords.bookingId, [...bookingIds]),
      ),
    );
}

/**
 * **Who may open a booking's forms page**: a `course_forms` link, which opens
 * that page and nothing else, or the diver's own `readiness` link, which
 * already opens everything about the booking. `formsOnly` says which, so the
 * page never offers a way back to a prep page the link cannot open. Null for
 * anything else — unknown, expired, revoked, another purpose.
 */
export async function verifyCourseFormsLink(
  db: DbExecutor,
  token: string,
): Promise<{ shopId: string; bookingId: string; formsOnly: boolean } | null> {
  const formsOnly = await verifyBookingCapability(db, { token, purpose: "course_forms" });
  if (formsOnly)
    return { shopId: formsOnly.shopId, bookingId: formsOnly.bookingId, formsOnly: true };
  const readiness = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (readiness)
    return { shopId: readiness.shopId, bookingId: readiness.bookingId, formsOnly: false };
  return null;
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
  /** What a form's placeholders are filled with (`fillCourseFormText`). */
  context: CourseFormContext;
};

/**
 * The session's instructors, by name, for a form's `{instructorNames}`: the
 * crew rostered as this trip's instructor, or — where the roster names no
 * role — the rostered crew who hold the shop's instructor role. Alphabetical,
 * joined for reading; empty when nobody is rostered yet.
 */
async function sessionInstructorNames(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<string> {
  const rows = await db
    .select({ name: people.fullName, tripRole: tripAssignments.tripRole, role: personRoles.role })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .leftJoin(
      personRoles,
      and(eq(personRoles.personId, people.id), eq(personRoles.role, "instructor")),
    )
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(tripAssignments.tripId, tripId),
        eq(people.shopId, shopId),
        liveTrip(),
      ),
    )
    .orderBy(asc(people.fullName));
  const names = rows
    .filter((row) =>
      row.tripRole === null ? row.role === "instructor" : row.tripRole === "instructor",
    )
    .map((row) => row.name);
  return [...new Set(names)].join(", ");
}

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
      shopName: shops.name,
      courseTitle: courses.title,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
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
    context: {
      shopName: row.shopName,
      courseTitle: row.courseTitle ?? row.tripTitle,
      instructorNames: await sessionInstructorNames(db, shopId, row.tripId),
    },
  };
}

/**
 * A form as the student reads it: the words, with this enrollment's
 * placeholders filled, and what is missing — `guardian_missing` when the
 * student already signed and only a parent's signature is owed.
 */
export type CourseFormToSign = RequiredCourseForm & { body: string; gap: CourseFormGap };

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
  now: Date = nowDate(),
): Promise<CourseFormsForBooking | null> {
  const enrollment = await enrollmentFor(db, shopId, bookingId);
  if (!enrollment) return null;
  const required =
    (await requiredCourseFormsForTrips(db, shopId, [enrollment.tripId], now)).get(
      enrollment.tripId,
    ) ?? [];
  if (required.length === 0) return { enrollment, required, outstanding: [] };
  const signatures = await courseFormSignaturesForBookings(db, shopId, [bookingId]);
  const owed = courseFormGaps({
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
          owed.map(({ form }) => form.versionId),
        ),
      ),
    );
  const bodyById = new Map(bodies.map((row) => [row.id, row.body]));
  return {
    enrollment,
    required,
    outstanding: owed.map(({ form, gap }) => ({
      ...form,
      gap,
      body: fillCourseFormText(bodyById.get(form.versionId) ?? "", enrollment.context),
    })),
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
 * Whether this form, signed now, needs a guardian beside the student: the
 * student is a minor today, or the student already signed it as a minor and
 * only the guardian's half is owed — a date of birth that reached the shop
 * after the signature, or a student who has since turned eighteen. Either
 * way the guardian is asked for; never the student's signature twice.
 */
async function guardianOwedFor(
  db: DbExecutor,
  shopId: string,
  enrollment: Enrollment,
  form: RequiredCourseForm,
  signedOn: CalendarDate,
): Promise<boolean> {
  if (guardianSignatureRequired(enrollment.dateOfBirth, signedOn)) return true;
  const signatures = await courseFormSignaturesForBookings(db, shopId, [enrollment.bookingId]);
  return courseFormGaps({
    shopId,
    bookingId: enrollment.bookingId,
    personId: enrollment.personId,
    required: [form],
    signatures,
    signer: { dateOfBirth: enrollment.dateOfBirth, timezone: enrollment.timezone },
  }).some(({ gap }) => gap === "guardian_missing");
}

/**
 * **A student signs one form on their own link.** The caller has already
 * proven the bearer owns `bookingId` (a verified `readiness` or `course_forms`
 * capability).
 *
 * The typed name must be the student's own, as the release's is
 * (`completeWaiver`); a minor's form takes a guardian's signature beside it
 * under the release's own rules, including the refusal of a co-signer typed
 * under the student's own name. A version that is no longer current is
 * refused rather than signed, so nobody puts their name to words the course
 * no longer asks for. Idempotent per enrollment and version — except that a
 * signature a minor gave alone takes the guardian's half once, when it comes.
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
      (await requiredCourseFormsForTrips(tx, input.shopId, [enrollment.tripId], now)).get(
        enrollment.tripId,
      ) ?? [];
    const form = requiredVersion(required, input.formVersionId);
    if (!form) return { ok: false, reason: "version_changed" };
    if (!personNamesMatch(evidence.signerName, enrollment.fullName)) {
      return { ok: false, reason: "name_mismatch" };
    }
    let guardian: GuardianEvidence | null = null;
    if (
      await guardianOwedFor(
        tx,
        input.shopId,
        enrollment,
        form,
        signingDate(now, enrollment.timezone),
      )
    ) {
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
      paperSignedOn: null,
      guardian,
    });
  });
}

type GuardianEvidence = {
  name: string;
  relationship: GuardianRelationship;
  method: string;
  consentedAt: Date;
  signedAt: Date;
};

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
    paperSignedOn: CalendarDate | null;
    guardian: GuardianEvidence | null;
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
  const guardianColumns = input.guardian
    ? {
        guardianName: input.guardian.name,
        guardianRelationship: input.guardian.relationship,
        guardianSignatureMethod: input.guardian.method,
        guardianConsentedAt: input.guardian.consentedAt,
        guardianSignedAt: input.guardian.signedAt,
      }
    : {};
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
      // The words exactly as the student read them, placeholders filled, and
      // what they were filled with beside them.
      formBody: fillCourseFormText(version.body, input.enrollment.context),
      courseTitle: input.enrollment.context.courseTitle,
      tripId: input.enrollment.tripId,
      instructorNames: input.enrollment.context.instructorNames,
      paperSignedOn: input.paperSignedOn,
      signedName: input.signedName,
      signatureMethod: input.method,
      recordedByPersonId: input.recordedByPersonId,
      consentedAt: input.consentedAt,
      signedAt: input.signedAt,
      ...guardianColumns,
    })
    .onConflictDoNothing({
      target: [courseFormRecords.bookingId, courseFormRecords.formVersionId],
    })
    .returning();
  if (record) {
    // Sealed in the transaction that wrote the evidence (issue #2266), over
    // the row as stored, the way the release seals its own.
    await tx
      .update(courseFormRecords)
      .set(courseFormSeal(record, COURSE_FORM_INTEGRITY_VERSION_SIGNED))
      .where(eq(courseFormRecords.id, record.id));
    return { ok: true, recordId: record.id, alreadySigned: false };
  }
  const [standing] = await tx
    .select()
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
  // **The guardian's half, once.** A minor who signed before the shop knew
  // their date of birth signed alone; the record stands, and the guardian who
  // signs now completes it. Written only into a record with no guardian, so
  // a signature already on file is never overwritten.
  //
  // The seal moves with it only when it verified the moment before, so
  // completing a record can never launder an edit made to it earlier: a
  // record that read `invalid` keeps reading `invalid`.
  if (input.guardian && standing.guardianSignedAt === null) {
    const sealHeld = verifyCourseFormIntegrity(standing) === "valid";
    const [completed] = await tx
      .update(courseFormRecords)
      .set(guardianColumns)
      .where(and(eq(courseFormRecords.id, standing.id), isNull(courseFormRecords.guardianSignedAt)))
      .returning();
    if (completed && sealHeld) {
      await tx
        .update(courseFormRecords)
        .set(courseFormSeal(completed, COURSE_FORM_INTEGRITY_VERSION_SIGNED))
        .where(eq(courseFormRecords.id, completed.id));
    }
  }
  return { ok: true, recordId: standing.id, alreadySigned: true };
}

export type PaperCourseFormOutcome =
  | SignCourseFormOutcome
  | {
      ok: false;
      reason:
        | "staff_not_found"
        | "guardian_name_matches_diver"
        /** The staffer did not confirm they hold the signed paper copy. */
        | "paper_copy_unconfirmed"
        /** The date on the paper is not a real day, or is after today. */
        | "invalid_date"
        /** The session is over: a form recorded now could not have counted for it. */
        | "session_ended";
    };

/**
 * **A staffer records a form the student signed on paper**, the same shape as
 * a paper release (`recordInPersonWaiver`): the record snapshots the form's
 * current words, is marked `in_person_attested`, and names the staffer who
 * recorded it. A minor's paper form names the guardian who co-signed it, and
 * the release's namesake rule applies unchanged — a co-signer whose name
 * reads as the student's is refused unless the staffer ticks that they watched
 * two people sign.
 *
 * The staffer confirms they hold the signed copy, and may give the date
 * written on it; the student's age is measured on that day. Refused, as the
 * student's own link refuses, on a seat held for staff to confirm who it is
 * and once the session is over — a paper copy is evidence for the session it
 * was signed for.
 */
export async function recordPaperCourseForm(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    formId: string;
    recordedByPersonId: string;
    paperCopyConfirmed: boolean;
    /** The date written on the paper, `YYYY-MM-DD`, when the staffer gave one. */
    signedOn?: string;
    guardian?: { name: string; relationship: string; namesakeAttested?: boolean };
    now?: Date;
  },
): Promise<PaperCourseFormOutcome> {
  const now = input.now ?? nowDate();
  if (!input.paperCopyConfirmed) return { ok: false, reason: "paper_copy_unconfirmed" };
  return db.transaction(async (tx): Promise<PaperCourseFormOutcome> => {
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.recordedByPersonId);
    if (!roles || !isStaff(roles)) return { ok: false, reason: "staff_not_found" };
    const enrollment = await enrollmentFor(tx, input.shopId, input.bookingId);
    // A held seat is not yet known to be this student's (#2082): a paper copy
    // recorded against it could be somebody else's signature.
    if (!enrollment || enrollment.identityHeld) return { ok: false, reason: "unavailable" };
    if (hasReturned(enrollment.endsAt, now)) return { ok: false, reason: "session_ended" };
    const today = signingDate(now, enrollment.timezone);
    let paperSignedOn: CalendarDate | null = null;
    if (input.signedOn !== undefined && input.signedOn !== "") {
      if (!isValidCalendarDate(input.signedOn) || input.signedOn > today) {
        return { ok: false, reason: "invalid_date" };
      }
      paperSignedOn = input.signedOn;
    }
    const required =
      (await requiredCourseFormsForTrips(tx, input.shopId, [enrollment.tripId], now)).get(
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
    let guardian: GuardianEvidence | null = null;
    if (await guardianOwedFor(tx, input.shopId, enrollment, form, paperSignedOn ?? today)) {
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
      paperSignedOn,
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
  now: Date = nowDate(),
): Promise<Map<string, RequiredCourseForm[]>> {
  const result = new Map<string, RequiredCourseForm[]>();
  const requiredByTrip = await requiredCourseFormsForTrips(db, shopId, tripIds, now);
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

/** How many students, on how many sessions, a change to forms reaches. */
export type CourseFormImpact = { students: number; sessions: number };

/**
 * **Who a new version of each form asks to sign again**, by form id — what the
 * form's editor says beside its Save, as the release's editor does before a
 * material change. A student who signed the current version on a session that
 * has not started: a session already under way keeps the version it started
 * with (`requiredCourseFormsForTrips`), and a student who has not signed yet
 * was going to sign anyway. A form that reaches nobody is absent.
 */
export async function courseFormResignImpact(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
): Promise<Map<string, CourseFormImpact>> {
  const result = new Map<string, CourseFormImpact>();
  const current = await listCourseForms(db, shopId);
  if (current.length === 0) return result;
  const rows = await db
    .selectDistinct({
      formId: courseFormRecords.formId,
      bookingId: bookings.id,
      tripId: trips.id,
    })
    .from(courseFormRecords)
    .innerJoin(bookings, eq(bookings.id, courseFormRecords.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(
      courseFormRequirements,
      and(
        eq(courseFormRequirements.courseId, trips.courseId),
        eq(courseFormRequirements.formId, courseFormRecords.formId),
      ),
    )
    .where(
      and(
        eq(courseFormRecords.shopId, shopId),
        inArray(
          courseFormRecords.formVersionId,
          current.map((form) => form.versionId),
        ),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        liveTrip(),
        gt(trips.startsAt, now),
        eq(courseFormRequirements.shopId, shopId),
        isNull(courseFormRequirements.deletedAt),
      ),
    );
  const seen = new Map<string, { bookings: Set<string>; trips: Set<string> }>();
  for (const row of rows) {
    const entry = seen.get(row.formId) ?? { bookings: new Set(), trips: new Set() };
    entry.bookings.add(row.bookingId);
    entry.trips.add(row.tripId);
    seen.set(row.formId, entry);
  }
  for (const [formId, entry] of seen) {
    result.set(formId, { students: entry.bookings.size, sessions: entry.trips.size });
  }
  return result;
}

/**
 * **Who a form added to this course asks to sign**: every live seat on a
 * session of it that has not started. A session under way keeps the forms it
 * started with, so it is not counted. The course's form picker says this
 * beside its Save.
 */
export async function courseUpcomingEnrollment(
  db: DbExecutor,
  shopId: string,
  courseId: string,
  now: Date = nowDate(),
): Promise<CourseFormImpact> {
  const rows = await db
    .select({ bookingId: bookings.id, tripId: trips.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        eq(trips.courseId, courseId),
        ne(trips.status, "cancelled"),
        liveTrip(),
        gt(trips.startsAt, now),
      ),
    );
  return {
    students: new Set(rows.map((row) => row.bookingId)).size,
    sessions: new Set(rows.map((row) => row.tripId)).size,
  };
}
