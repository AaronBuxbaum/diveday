import { aliasedTable, and, asc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

export type CourseMaterialsDoneOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_a_course_session" };

/**
 * How far apart two departures of one course may start and still be one
 * enrollment for the materials tick. A course run as a pool weekend and an
 * open-water weekend a month later is one student finishing one eLearning; the
 * same course taken again next season is not.
 */
export const COURSE_MATERIALS_WINDOW_DAYS = 120;
const WINDOW_MS = COURSE_MATERIALS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Who marked a student's materials done, and when. */
export type CourseMaterialsDone = { at: Date; byPersonId: string; byName: string | null };

/**
 * **Whether each person has finished this course's materials**, read across
 * every live departure of the course that starts within
 * {@link COURSE_MATERIALS_WINDOW_DAYS} of `around` (ADR
 * 20261008-course-learning-materials). A course run as several departures is
 * one enrollment: ticked on the pool session, it is done on the open-water
 * one too. The earliest stamp wins, the same rule a repeat tick follows.
 *
 * The roster, the week-out reminder and `/ready` all read "done" here, so the
 * three can never disagree.
 */
export async function courseMaterialsDoneByPerson(
  db: AppDb,
  input: { shopId: string; courseId: string; personIds: readonly string[]; around: Date },
): Promise<Map<string, CourseMaterialsDone>> {
  const done = new Map<string, CourseMaterialsDone>();
  if (input.personIds.length === 0) return done;
  const marker = aliasedTable(people, "materials_marker");
  const rows = await db
    .select({
      personId: bookings.personId,
      at: bookings.courseMaterialsDoneAt,
      byPersonId: bookings.courseMaterialsDoneByPersonId,
      byName: marker.fullName,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(marker, eq(marker.id, bookings.courseMaterialsDoneByPersonId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        eq(trips.courseId, input.courseId),
        inArray(bookings.personId, [...input.personIds]),
        ne(bookings.status, "cancelled"),
        isNotNull(bookings.courseMaterialsDoneAt),
        gte(trips.startsAt, new Date(input.around.getTime() - WINDOW_MS)),
        lte(trips.startsAt, new Date(input.around.getTime() + WINDOW_MS)),
        liveTrip(),
      ),
    )
    .orderBy(asc(bookings.courseMaterialsDoneAt));
  for (const row of rows) {
    if (!row.at || !row.byPersonId || done.has(row.personId)) continue;
    done.set(row.personId, { at: row.at, byPersonId: row.byPersonId, byName: row.byName });
  }
  return done;
}

/**
 * **A staffer ticks a student's learning materials done, or takes the tick
 * back** (ADR 20261008-course-learning-materials), from the course session's
 * own roster.
 *
 * Same boundary as `recordCourseNextStep`: a departure with no `course_id` is
 * `not_a_course_session`, so a fun dive never grows a homework column. The
 * stamp and its author move together (the `bookings_course_materials_done_
 * attributed` check refuses any other combination), and a second tick keeps
 * the first stamp rather than moving it — "done on Tuesday, by Ana" stays what
 * it was when a colleague taps it again from a stale tab. A tick already made
 * on another departure of the same course counts as that first stamp.
 *
 * Taking it back clears the person's stamp on every departure of the course
 * the read above would count, so "not done" is never contradicted by a tick
 * left on a sibling session.
 *
 * Tenant-scoped twice: the seat is read under `shopId`, and every write
 * matches on `shopId` too. Codes, never sentences.
 */
export async function recordCourseMaterialsDone(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    staffPersonId: string;
    done: boolean;
    now?: Date;
  },
): Promise<CourseMaterialsDoneOutcome> {
  const [seat] = await db
    .select({
      id: bookings.id,
      personId: bookings.personId,
      courseId: trips.courseId,
      startsAt: trips.startsAt,
      doneAt: bookings.courseMaterialsDoneAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!seat) return { ok: false, reason: "not_found" };
  if (!seat.courseId) return { ok: false, reason: "not_a_course_session" };

  if (input.done) {
    if (seat.doneAt) return { ok: true };
    const already = await courseMaterialsDoneByPerson(db, {
      shopId: input.shopId,
      courseId: seat.courseId,
      personIds: [seat.personId],
      around: seat.startsAt,
    });
    if (already.has(seat.personId)) return { ok: true };
    await db
      .update(bookings)
      .set({
        courseMaterialsDoneAt: input.now ?? nowDate(),
        courseMaterialsDoneByPersonId: input.staffPersonId,
      })
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
    return { ok: true };
  }

  const siblings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        eq(trips.courseId, seat.courseId),
        eq(bookings.personId, seat.personId),
        gte(trips.startsAt, new Date(seat.startsAt.getTime() - WINDOW_MS)),
        lte(trips.startsAt, new Date(seat.startsAt.getTime() + WINDOW_MS)),
        liveTrip(),
      ),
    );
  await db
    .update(bookings)
    .set({ courseMaterialsDoneAt: null, courseMaterialsDoneByPersonId: null })
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        inArray(bookings.id, [input.bookingId, ...siblings.map((row) => row.id)]),
      ),
    );
  return { ok: true };
}
