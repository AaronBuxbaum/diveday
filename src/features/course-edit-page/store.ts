import { assistsAvailable } from "@/features/assists";
import { getCourseBySlug, getCourseTemplateUpdate } from "@/features/courses";
import { canPersonConfigureTrips } from "../../db/authz";
import type { AppDb } from "../../db/client";

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
