import { assistsAvailable } from "./assists";
import { canPersonConfigureTrips } from "./authz";
import type { AppDb } from "./client";
import { courseIdsEverOnBoard, getCourseBySlug, getCourseTemplateUpdate } from "./courses";

/**
 * The course editor's question in one call: the course, whether this person
 * may set its visibility, its template update, whether assists are lit, and
 * whether a template course has ever been on the board (asked only when the
 * person may schedule it, since nothing else reads the answer). Null when the
 * slug names no course of this shop.
 */
export async function getCourseEditPage(db: AppDb, shopId: string, slug: string, personId: string) {
  const course = await getCourseBySlug(db, shopId, slug);
  if (!course) return null;
  const [setVisibility, templateUpdate, assists] = await Promise.all([
    canPersonConfigureTrips(db, shopId, personId),
    getCourseTemplateUpdate(db, shopId, course.id),
    assistsAvailable(db, shopId),
  ]);
  const everOnBoard =
    setVisibility && course.sourceTemplateSlug !== null
      ? (await courseIdsEverOnBoard(db, shopId, [course.id])).has(course.id)
      : false;
  return { course, can: { setVisibility, assist: assists }, templateUpdate, everOnBoard };
}
