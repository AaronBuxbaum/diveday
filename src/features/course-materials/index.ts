/** course-materials public contract. Internals are imported only within this module. */
export type { CourseMaterialsDone, CourseMaterialsDoneOutcome } from "./store";
export {
  COURSE_MATERIALS_WINDOW_DAYS,
  courseMaterialsDoneByPerson,
  recordCourseMaterialsDone,
} from "./store";
