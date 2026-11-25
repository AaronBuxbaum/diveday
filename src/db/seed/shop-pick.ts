import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { courses, shops } from "../schema";

/** The course the demo shop features: the first-timer's door, the one a diver is most likely to want. */
const PICKED_COURSE_TITLE = "Discover Scuba Diving";

/**
 * **The demo shop's pick** (#4928): it features Discover Scuba Diving above the schedule.
 *
 * A course, not one departure, because the page reads a pick back through the live, still-ahead
 * scope: a departure id would lapse the day it sailed, and a reset gives every trip and course a
 * new id. A course pick is looked up by title here, after the catalog is seeded, on every seed and
 * every reset, and the storefront draws its next dates from the sessions that are ahead, so it
 * never reads as stale. A pick the shop made of a departure, or of a course that still exists, is
 * left alone; the id of a course a reset deleted is replaced.
 */
export async function seedShopPick(db: DbExecutor, shopId: string): Promise<void> {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.shopId, shopId),
        eq(courses.title, PICKED_COURSE_TITLE),
        eq(courses.isActive, true),
      ),
    )
    .limit(1);
  if (!course) return;
  await db
    .update(shops)
    .set({ pickCourseId: course.id })
    .where(
      and(
        eq(shops.id, shopId),
        isNull(shops.pickTripId),
        or(
          isNull(shops.pickCourseId),
          sql`${shops.pickCourseId} not in (select ${courses.id} from ${courses} where ${courses.shopId} = ${shopId})`,
        ),
      ),
    );
}
