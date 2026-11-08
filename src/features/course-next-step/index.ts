/** course-next-step public contract. Internals are imported only within this module. */

export type { CourseNextStepOutcome } from "./store";
export {
  courseNextStepForBooking,
  courseNextStepsByBooking,
  MAX_COURSE_NEXT_STEP_LENGTH,
  recordCourseNextStep,
} from "./store";
