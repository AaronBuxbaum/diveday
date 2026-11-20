/** course-progress public contract. Internals are imported only within this module. */

export type { CourseStepDone, CourseStepOutcome } from "./store";
export {
  courseProgressByPerson,
  courseProgressFor,
  courseStepTitles,
  recordCourseStepDone,
} from "./store";
