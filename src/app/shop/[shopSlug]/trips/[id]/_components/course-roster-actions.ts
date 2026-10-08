import {
  certifyDiverFromRosterAction,
  saveCourseNextStepAction,
  setCourseMaterialsDoneAction,
} from "../actions";

/**
 * A course session's three acts of teaching on the Divers tab, bound to this
 * departure: certify a student, write their next step, mark their learning
 * materials done. They travel together, because a roster that could certify a
 * student but not tell them what comes next is half a session's record. A fun
 * dive gets none of them, and each writer refuses one anyway.
 *
 * The materials tick is drawn per seat only when the course carries materials
 * (`TripGuests.courseHasMaterials`, ADR 20261008-course-learning-materials).
 */
export function courseRosterActions(isCourseSession: boolean, shopSlug: string, tripId: string) {
  if (!isCourseSession) return {};
  return {
    certifyDiverAction: certifyDiverFromRosterAction.bind(null, shopSlug, tripId),
    saveCourseNextStepAction: saveCourseNextStepAction.bind(null, shopSlug, tripId),
    setCourseMaterialsDoneAction: setCourseMaterialsDoneAction.bind(null, shopSlug, tripId),
  };
}
