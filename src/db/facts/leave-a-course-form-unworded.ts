import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  createCourseForm,
  listCourseFormRequirements,
  setCourseFormRequirements,
} from "@/db/course-forms";
import { courses } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { FactRefused } from "./refusal";

/**
 * **A course form with a title and no words yet** (`unwordedCourseForm`) on the
 * demo's Open Water Diver course, so the Courses roster's agency-wording notice
 * has something to say (UX review 2026-10-10, item 16). The seed words every
 * form the demo requires; this is the moment a shop meets the notice, having
 * named the agency's form and not yet written it. Through `createCourseForm`
 * and `setCourseFormRequirements`, the course editor's own doors, appended to
 * the forms the course already requires.
 */
export async function leaveACourseFormUnworded(db: AppDb, shopId: string) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, "Open Water Diver")))
    .limit(1);
  if (!course) throw new FactRefused("no_course", 404);
  const [staff] = await listStaff(db, shopId);
  if (!staff) throw new FactRefused("no_staff", 404);
  const form = await createCourseForm(db, {
    shopId,
    title: "Youth Diving: Responsibility and Risks Acknowledgment",
    body: "",
    actorPersonId: staff.person.id,
  });
  const current = await listCourseFormRequirements(db, shopId, course.id);
  const saved = await setCourseFormRequirements(db, {
    shopId,
    courseId: course.id,
    formIds: [...current, form.id],
    // Adding a form asks more students, which any writer may.
    mayNarrow: false,
  });
  if (!saved.ok) throw new FactRefused(saved.reason);
}
