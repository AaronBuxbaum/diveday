import { and, eq, isNotNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** The longest a next step may be — one thing to do, not a lesson plan. */
export const MAX_COURSE_NEXT_STEP_LENGTH = 280;

export type CourseNextStepOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_a_course_session" | "too_long" };

/**
 * **What the instructor tells this student to do next** (issues #1196 and
 * #1205, delight reports D36 and D45), written from the course session's own
 * roster and read by the student on their recap.
 *
 * **The LMS boundary is this function's first refusal, not a comment.** A
 * departure with no `course_id` is `not_a_course_session`: DiveDay records
 * what a shop's instructor wrote for a student on a course day, and the moment
 * a next step could be attached to an ordinary charter it starts to look like
 * a curriculum the software is keeping.
 *
 * The words and their attribution move together — clearing the note clears the
 * stamp and the author with it — because a sentence a student reads has to
 * carry who said it, and the check constraint on `bookings` refuses any other
 * combination anyway.
 *
 * Codes, never sentences: the surface picks the words.
 */
export async function recordCourseNextStep(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    instructorPersonId: string;
    note: string;
    now?: Date;
  },
): Promise<CourseNextStepOutcome> {
  const words = input.note.trim();
  if (words.length > MAX_COURSE_NEXT_STEP_LENGTH) return { ok: false, reason: "too_long" };

  const [seat] = await db
    .select({ id: bookings.id, courseId: trips.courseId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!seat) return { ok: false, reason: "not_found" };
  if (!seat.courseId) return { ok: false, reason: "not_a_course_session" };

  await db
    .update(bookings)
    .set(
      words
        ? {
            courseNextStep: words,
            courseNextStepAt: input.now ?? nowDate(),
            courseNextStepByPersonId: input.instructorPersonId,
          }
        : { courseNextStep: null, courseNextStepAt: null, courseNextStepByPersonId: null },
    )
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)));
  return { ok: true };
}

/**
 * The next steps written for one departure's roster, keyed by booking — what
 * the staff surface renders back into each student's box so an instructor sees
 * what they already said rather than an empty field.
 */
export async function courseNextStepsByBooking(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ bookingId: bookings.id, note: bookings.courseNextStep })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        isNotNull(bookings.courseNextStep),
        liveTrip(),
      ),
    );
  return new Map(rows.flatMap((row) => (row.note ? [[row.bookingId, row.note] as const] : [])));
}
