import { assistsAvailable } from "./assists";
import { canPersonConfigureTrips } from "./authz";
import type { AppDb } from "./client";
import { getCourseBySlug, getCourseTemplateUpdate } from "./courses";

/**
 * The course editor's question in one call: the course, whether this person
 * may set its visibility, its template update, whether assists are lit. Null when the slug names no course of this shop.
 */
export async function getCourseEditPage(db: AppDb, shopId: string, slug: string, personId: string) {
  const course = await getCourseBySlug(db, shopId, slug);
  if (!course) return null;
  const [setVisibility, templateUpdate, assists] = await Promise.all([
    canPersonConfigureTrips(db, shopId, personId),
    getCourseTemplateUpdate(db, shopId, course.id),
    assistsAvailable(db, shopId),
  ]);
  return { course, can: { setVisibility, assist: assists }, templateUpdate };
}
