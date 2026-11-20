import { assistsAvailable } from "@/features/assists";
import { getCourseBySlug, getCourseTemplateUpdate } from "@/features/courses";
import { canPersonEditCourseTemplates } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { courseCodeCounts } from "../../db/course-codes";

/**
 * The course editor's question in one call: the course, whether this person
 * may edit it, its template update, whether assists are lit. Null when the slug names no course of this shop.
 */
export async function getCourseEditPage(db: AppDb, shopId: string, slug: string, personId: string) {
  const course = await getCourseBySlug(db, shopId, slug);
  if (!course) return null;
  const [edit, templateUpdate, assists, elearningCodes] = await Promise.all([
    canPersonEditCourseTemplates(db, shopId, personId),
    getCourseTemplateUpdate(db, shopId, course.id),
    assistsAvailable(db, shopId),
    courseCodeCounts(db, { shopId, courseId: course.id }),
  ]);
  return { course, can: { edit, assist: assists }, templateUpdate, elearningCodes };
}
