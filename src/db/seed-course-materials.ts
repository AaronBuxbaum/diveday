import { and, asc, eq, ne } from "drizzle-orm";
import type { CourseLearningMaterial } from "@/lib/courses";
import type { DbExecutor } from "./client";
import { bookings, courses, people, trips } from "./schema";
import { at } from "./seed-clock";
import { liveTrip } from "./trips-live";

/**
 * **The links a shop pastes into its course materials, and one student who
 * has finished them** (ADR 20261008-course-learning-materials).
 *
 * The templates ship each eLearning line as a name and a note, never a link:
 * which page a student should open is the shop's choice. So without this the
 * demo would only ever show the link-less row, and the confirmation, the
 * reminder and `/ready` would never draw a link anyone could tap. The link is
 * the agency's own front page — real, stable, and nothing DiveDay fetches.
 *
 * Then one tick: the first student on the earliest Advanced Open Water session
 * is marked done by the instructor, so the roster shows both states side by
 * side. It gates nothing — admission and readiness never read the column — so
 * no count, head count or roster membership moves.
 *
 * Adds-only and late, like the scenarios around it in `seed.ts`; a course or a
 * session that is not there is skipped rather than thrown on.
 */
const MATERIALS_BY_TITLE: Record<string, CourseLearningMaterial[]> = {
  "Open Water Diver": [
    {
      name: "PADI Open Water Diver eLearning",
      url: "https://www.padi.com/",
      note: "Finish before day 1",
    },
  ],
  "Advanced Open Water Diver": [
    {
      name: "PADI Advanced Open Water Diver eLearning",
      url: "https://www.padi.com/",
      note: "Finish before day 1",
    },
    { name: "Dive computer manual", note: "Bring your computer to day 1" },
  ],
};

export async function seedCourseMaterials(
  db: DbExecutor,
  shopId: string,
  options: { instructorId: string },
) {
  // Serial, never `Promise.all`: a drizzle transaction is one checked-out
  // client (`scripts/check-db-concurrency.mjs`).
  for (const [title, learningMaterials] of Object.entries(MATERIALS_BY_TITLE)) {
    await db
      .update(courses)
      .set({ learningMaterials })
      .where(and(eq(courses.shopId, shopId), eq(courses.title, title)));
  }

  const [advanced] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, "Advanced Open Water Diver")))
    .limit(1);
  if (!advanced) return;
  const [student] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.courseId, advanced.id),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
        liveTrip(),
      ),
    )
    // By name before the id: under the frozen clock every seat shares one
    // instant, and a uuid choosing the ticked student would re-pick it per seed.
    .orderBy(asc(trips.startsAt), asc(people.fullName), asc(bookings.id))
    .limit(1);
  if (!student) return;
  await db
    .update(bookings)
    .set({
      // Yesterday morning, at the desk.
      courseMaterialsDoneAt: at(-1, 10),
      courseMaterialsDoneByPersonId: options.instructorId,
    })
    .where(and(eq(bookings.shopId, shopId), eq(bookings.id, student.id)));
}
