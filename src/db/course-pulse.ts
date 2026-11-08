import { and, eq, isNull, or, sql } from "drizzle-orm";
import { MINUTE_MS, nowDate } from "@/lib/clock";
import { COURSE_TEACHING_NOTE_MAX, coursePrepItems } from "@/lib/course-pulse";
import { readLearningMaterials } from "@/lib/courses";
import { seatName } from "@/lib/held-seat";
import { isDiver } from "@/lib/participant-types";
import { readActiveStaffRoles } from "./authz";
import type { AppDb } from "./client";
import { courseMaterialsDoneByPerson } from "./course-materials";
import { people, shops, tripAssignments, trips } from "./schema";
import { loadTripSharedReads, type TripSharedReads } from "./trip-shared-reads";
import { livePerson, liveTrip } from "./trips-live";

/** Live teaching audience: operations leads or this departure's assigned instructor. */
export async function canPersonUseCoursePulse(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<boolean> {
  const roles = await readActiveStaffRoles(db, shopId, personId);
  if (!roles) return false;
  if (roles.some((role) => role === "owner" || role === "manager")) return true;
  if (!roles.includes("instructor")) return false;
  const [assignment] = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(
      and(
        eq(tripAssignments.personId, personId),
        eq(tripAssignments.tripId, tripId),
        or(eq(tripAssignments.tripRole, "instructor"), isNull(tripAssignments.tripRole)),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    )
    .limit(1);
  return assignment !== undefined;
}

/** Private preparation summary on a course departure's existing Divers tab. */
export async function getCoursePulse(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
  shared?: Promise<TripSharedReads | null>,
) {
  const [shop] = await db
    .select({ enabled: shops.coursePulseEnabled })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop?.enabled || !(await canPersonUseCoursePulse(db, shopId, tripId, personId))) return null;
  const reads = await (shared ?? loadTripSharedReads(db, shopId, tripId));
  if (!reads?.trip.course || reads.trip.status === "cancelled") return null;
  const { trip, readiness, requirement } = reads;
  const course = trip.course;
  if (!course) return null;
  const students = readiness.filter((row) => isDiver(row.booking.participantType));
  const materialsAsked = readLearningMaterials(course.learningMaterials).length > 0;
  const materials = materialsAsked
    ? await courseMaterialsDoneByPerson(db, {
        shopId,
        courseId: course.id,
        personIds: students
          .filter((row) => !row.booking.identityUnconfirmedAt)
          .map((row) => row.person.id),
        around: trip.startsAt,
      })
    : new Map();
  const rows = students.map((row) => ({
    bookingId: row.booking.id,
    fullName: seatName(row.person.fullName, row.booking),
    items: row.booking.identityUnconfirmedAt
      ? ["staff" as const]
      : coursePrepItems({
          requirement,
          readiness: row.readiness,
          participantType: row.booking.participantType,
          materialsAsked,
          materialsDone: materials.has(row.person.id),
        }),
  }));
  const [privateNote] = await db
    .select({
      note: trips.courseTeachingNote,
      deletedAt: trips.courseTeachingNoteDeletedAt,
      at: trips.courseTeachingNoteAt,
      by: trips.courseTeachingNoteByPersonId,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!privateNote) return null;
  const [author] = privateNote.by
    ? await db
        .select({ fullName: people.fullName })
        .from(people)
        .where(and(eq(people.id, privateNote.by), eq(people.shopId, shopId), livePerson()))
        .limit(1)
    : [];
  return {
    rows,
    complete: rows.filter((row) => row.items.length === 0).length,
    note: privateNote.deletedAt ? null : privateNote.note,
    noteAt: privateNote.deletedAt ? null : privateNote.at,
    noteBy: privateNote.deletedAt ? null : (author?.fullName ?? null),
  };
}

export type CoursePulse = NonNullable<Awaited<ReturnType<typeof getCoursePulse>>>;
export type CourseTeachingNoteResult =
  | { ok: true; note: string | null; deletedRevision?: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "forbidden"
        | "disabled"
        | "not_a_course_session"
        | "cancelled"
        | "too_long"
        | "changed"
        | "invalid";
    };

/** One shared instructor note, guarded against a stale tab overwriting a colleague. */
export async function recordCourseTeachingNote(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    personId: string;
    note: string;
    expectedNote: string | null;
    restoreRevision?: number;
  },
): Promise<CourseTeachingNoteResult> {
  const [trip] = await db
    .select({
      id: trips.id,
      courseId: trips.courseId,
      status: trips.status,
      enabled: shops.coursePulseEnabled,
      note: trips.courseTeachingNote,
      noteDeletedAt: trips.courseTeachingNoteDeletedAt,
      noteRevision: trips.courseTeachingNoteRevision,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return { ok: false, reason: "not_found" };
  if (!trip.enabled) return { ok: false, reason: "disabled" };
  if (!(await canPersonUseCoursePulse(db, input.shopId, input.tripId, input.personId))) {
    return { ok: false, reason: "forbidden" };
  }
  if (!trip.courseId) return { ok: false, reason: "not_a_course_session" };
  if (trip.status === "cancelled") return { ok: false, reason: "cancelled" };
  const now = nowDate();
  const restoring = input.restoreRevision !== undefined;
  if (
    restoring &&
    (!trip.noteDeletedAt ||
      !trip.note ||
      trip.noteRevision !== input.restoreRevision ||
      now.getTime() - trip.noteDeletedAt.getTime() > 15 * MINUTE_MS)
  )
    return { ok: false, reason: "changed" };
  const note = restoring ? trip.note : input.note.trim() || null;
  const deleting = !note && !!trip.note && !trip.noteDeletedAt;
  if (!note && trip.noteDeletedAt && !restoring) return { ok: true, note: null };
  if (note && note.length > COURSE_TEACHING_NOTE_MAX) return { ok: false, reason: "too_long" };
  const [recorded] = await db
    .update(trips)
    .set({
      ...(deleting || restoring
        ? {}
        : {
            courseTeachingNote: note,
            courseTeachingNoteAt: note ? now : null,
            courseTeachingNoteByPersonId: note ? input.personId : null,
          }),
      courseTeachingNoteDeletedAt: deleting ? now : null,
      courseTeachingNoteRevision: sql`${trips.courseTeachingNoteRevision} + 1`,
    })
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        eq(trips.courseId, trip.courseId),
        restoring
          ? and(
              eq(trips.courseTeachingNoteRevision, input.restoreRevision ?? 0),
              sql`${trips.courseTeachingNoteDeletedAt} is not null`,
            )
          : sql`(case when ${trips.courseTeachingNoteDeletedAt} is null then ${trips.courseTeachingNote} else null end) is not distinct from ${input.expectedNote}`,
        eq(trips.status, trip.status),
        liveTrip(),
      ),
    )
    .returning({ id: trips.id, noteRevision: trips.courseTeachingNoteRevision });
  return recorded
    ? { ok: true, note, ...(deleting ? { deletedRevision: recorded.noteRevision } : {}) }
    : { ok: false, reason: "changed" };
}
