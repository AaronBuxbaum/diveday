import { and, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

export type CourseMaterialsDoneOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_a_course_session" };

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
 * it was when a colleague taps it again from a stale tab.
 *
 * Tenant-scoped twice: the seat is read under `shopId`, and the write matches
 * on `shopId` too. Codes, never sentences.
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
      courseId: trips.courseId,
      doneAt: bookings.courseMaterialsDoneAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!seat) return { ok: false, reason: "not_found" };
  if (!seat.courseId) return { ok: false, reason: "not_a_course_session" };
  if (input.done && seat.doneAt) return { ok: true };

  await db
    .update(bookings)
    .set(
      input.done
        ? {
            courseMaterialsDoneAt: input.now ?? nowDate(),
            courseMaterialsDoneByPersonId: input.staffPersonId,
          }
        : { courseMaterialsDoneAt: null, courseMaterialsDoneByPersonId: null },
    )
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  return { ok: true };
}
