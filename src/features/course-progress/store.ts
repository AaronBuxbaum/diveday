import { aliasedTable, and, asc, eq, inArray } from "drizzle-orm";
import { liveTrip } from "@/db/trips";
import type { AppDb } from "../../db/client";
import { bookings, courseSessionProgress, courses, people, trips } from "../../db/schema/index";

export type CourseStepOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_a_course_session" | "unknown_step" };

/** Who ticked a course step done, and when. */
export type CourseStepDone = { at: Date; byName: string | null };

/**
 * **The steps each student has been ticked through**, by person then step title (ADR
 * 20261120-course-session-progress). A student's progress belongs to the course, not to one
 * departure: ticked on the pool night, it shows on the open-water weekend of the same course.
 */
export async function courseProgressByPerson(
  db: AppDb,
  input: { shopId: string; courseId: string; personIds: readonly string[] },
): Promise<Map<string, Map<string, CourseStepDone>>> {
  const progress = new Map<string, Map<string, CourseStepDone>>();
  if (input.personIds.length === 0) return progress;
  const marker = aliasedTable(people, "progress_marker");
  const rows = await db
    .select({
      personId: courseSessionProgress.personId,
      stepTitle: courseSessionProgress.stepTitle,
      at: courseSessionProgress.doneAt,
      byName: marker.fullName,
    })
    .from(courseSessionProgress)
    .leftJoin(marker, eq(marker.id, courseSessionProgress.doneByPersonId))
    .where(
      and(
        eq(courseSessionProgress.shopId, input.shopId),
        eq(courseSessionProgress.courseId, input.courseId),
        inArray(courseSessionProgress.personId, [...input.personIds]),
      ),
    )
    .orderBy(asc(courseSessionProgress.doneAt));
  for (const row of rows) {
    const steps = progress.get(row.personId) ?? new Map<string, CourseStepDone>();
    steps.set(row.stepTitle, { at: row.at, byName: row.byName });
    progress.set(row.personId, steps);
  }
  return progress;
}

/**
 * **A staffer ticks one step of a student's course done, or takes the tick back.** From the
 * course session's own roster; the step must be one the course's outline names, so a stale tab
 * cannot invent one. The first stamp wins on a repeat tick. Informs, never gates: nothing in
 * admission, readiness, the manifest or Certify reads it. Scoped by `shopId` on the seat and
 * on every write. Codes, never sentences.
 */
export async function recordCourseStepDone(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    staffPersonId: string;
    stepTitle: string;
    done: boolean;
  },
): Promise<CourseStepOutcome> {
  const [seat] = await db
    .select({
      personId: bookings.personId,
      courseId: trips.courseId,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!seat) return { ok: false, reason: "not_found" };
  if (!seat.courseId) return { ok: false, reason: "not_a_course_session" };
  const step = input.stepTitle.trim();
  const outline = await courseOutlineTitles(db, input.shopId, seat.courseId);
  if (!step || !outline.includes(step)) return { ok: false, reason: "unknown_step" };

  if (input.done) {
    await db
      .insert(courseSessionProgress)
      .values({
        shopId: input.shopId,
        personId: seat.personId,
        courseId: seat.courseId,
        stepTitle: step,
        doneByPersonId: input.staffPersonId,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(courseSessionProgress)
      .where(
        and(
          eq(courseSessionProgress.shopId, input.shopId),
          eq(courseSessionProgress.personId, seat.personId),
          eq(courseSessionProgress.courseId, seat.courseId),
          eq(courseSessionProgress.stepTitle, step),
        ),
      );
  }
  return { ok: true };
}

/** The titles of a course's outline days, in order: the steps a student can be ticked through. */
export async function courseOutlineTitles(db: AppDb, shopId: string, courseId: string) {
  const [course] = await db
    .select({ days: courses.scheduleDays })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .limit(1);
  return courseStepTitles(course?.days ?? []);
}

/** A course's steps, read off its outline: each day's title, once, in order. */
export function courseStepTitles(days: readonly { title: string }[]): string[] {
  const titles: string[] = [];
  for (const day of days) {
    const title = day.title.trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

/**
 * A departure's course outline and each student's ticks, in one read, shaped as the roster's
 * fields; empty off a course session.
 */
export async function courseProgressFor(
  db: AppDb,
  shopId: string,
  courseId: string | null,
  roster: readonly { person: { id: string } }[],
) {
  const personIds = roster.map(({ person }) => person.id);
  if (!courseId) {
    return {
      courseSteps: [] as string[],
      courseProgressByPerson: new Map<string, Map<string, CourseStepDone>>(),
    };
  }
  const [courseSteps, courseProgressByPerson_] = await Promise.all([
    courseOutlineTitles(db, shopId, courseId),
    courseProgressByPerson(db, { shopId, courseId, personIds }),
  ]);
  return { courseSteps, courseProgressByPerson: courseProgressByPerson_ };
}
