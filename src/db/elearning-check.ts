import { and, eq, inArray, isNull } from "drizzle-orm";
import { type ElearningQuery, elearningCheckQuery } from "@/lib/elearning-check";
import type { AppDb } from "./client";
import { courseMaterialsDoneByPerson } from "./course-materials";
import { bookings, courses, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * One course seat the DiveDay browser extension may check against the
 * agency's eLearning page (H-106), and what it would search for: a live seat
 * (booked or checked in) on a live course session at this shop, held by a live
 * person, on a course from an agency whose eLearning the extension reads.
 * `materialsDone` says whether the student's learning materials are already
 * ticked, and `materialsDoneBy` by whom, read the way the roster reads them
 * (`courseMaterialsDoneByPerson`: the person's, across every departure of the
 * course), so a check never re-stamps a colleague's tick and its Undo never
 * takes one back.
 * Null for anything else, including another shop's booking.
 */
export async function seatForElearningCheck(
  db: AppDb,
  input: { shopId: string; tripId: string; bookingId: string },
): Promise<{
  query: ElearningQuery;
  materialsDone: boolean;
  materialsDoneBy: string | null;
} | null> {
  const [row] = await db
    .select({
      agency: courses.agency,
      courseTitle: courses.title,
      fullName: people.fullName,
      email: people.email,
      personId: bookings.personId,
      courseId: trips.courseId,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(courses, eq(courses.id, trips.courseId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.tripId, input.tripId),
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        eq(courses.shopId, input.shopId),
        eq(people.shopId, input.shopId),
        inArray(bookings.status, ["booked", "checked_in"]),
        liveTrip(),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const query = elearningCheckQuery(row);
  if (!query || !row.courseId) return null;
  const done = (
    await courseMaterialsDoneByPerson(db, {
      shopId: input.shopId,
      courseId: row.courseId,
      personIds: [row.personId],
      around: row.startsAt,
    })
  ).get(row.personId);
  return { query, materialsDone: Boolean(done), materialsDoneBy: done?.byPersonId ?? null };
}
