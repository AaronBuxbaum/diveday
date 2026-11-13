import { type CourseListView, coursesAwaitingFormText, pagedCourses } from "@/features/courses";
import { canPersonConfigureTrips, canPersonEditCourseTemplates } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { nextSessionStartByCourse } from "../../db/trips";

export { COURSE_LIST_VIEWS, courseListViewParam } from "@/features/courses";

/**
 * The course roster's question in one call: one page of courses (agency-major,
 * then progression order), whether this person may schedule one, the courses
 * whose agency forms still have no text, and when each course on the page
 * next runs (the one read that needs the page, so the others go beside it).
 *
 * The next sessions are read `"shop"`-scoped, not `"storefront"`: a course
 * booked out to one family is scheduled, and the staffer who scheduled it must
 * not read "Not scheduled" on the morning it runs.
 */
export async function getCoursesPage(
  db: AppDb,
  shopId: string,
  personId: string,
  options: { page: number; query: string; view: CourseListView | undefined },
) {
  const [coursePage, canSchedule, canEdit, formsAwaitingText] = await Promise.all([
    pagedCourses(db, shopId, options),
    canPersonConfigureTrips(db, shopId, personId),
    canPersonEditCourseTemplates(db, shopId, personId),
    coursesAwaitingFormText(db, shopId),
  ]);
  const nextSessions = await nextSessionStartByCourse(
    db,
    shopId,
    coursePage.courses.map((course) => course.id),
    "shop",
  );
  return {
    coursePage,
    can: { schedule: canSchedule, edit: canEdit },
    nextSessions,
    formsAwaitingText,
  };
}
