import {
  certifyDiverFromRosterAction,
  markCardProcessedAction,
  saveCourseNextStepAction,
  setCourseMaterialsDoneAction,
  setCourseStepDoneAction,
} from "../course-actions";
import { elearningCheckAction } from "../elearning-actions";
import { setElearningCodeAction } from "../elearning-code-actions";
import { referralStudentAction } from "../referral-actions";
import { clearTrainingDiveAction, markTrainingDiveAction } from "../training-mark-actions";

/**
 * A course session's three acts of teaching on the Trip page, bound to this
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
    markCardProcessedAction: markCardProcessedAction.bind(null, shopSlug, tripId),
    setCourseMaterialsDoneAction: setCourseMaterialsDoneAction.bind(null, shopSlug, tripId),
    setCourseStepDoneAction: setCourseStepDoneAction.bind(null, shopSlug, tripId),
    setElearningCodeAction: setElearningCodeAction.bind(null, shopSlug, tripId),
    elearningCheckAction: elearningCheckAction.bind(null, shopSlug, tripId),
    // A referral student and the papers the desk collects (loop 5, row 10).
    referralStudentAction: referralStudentAction.bind(null, shopSlug, tripId),
  };
}

/**
 * Mark and clear a training dive on a charter seat (issue #2275), bound only
 * where both can be used: a departure that is not itself a course session,
 * for a staffer who may configure trips (owner, manager, instructor). A
 * captain is offered neither (security review U7); each writer refuses one
 * anyway.
 */
export function trainingMarkRosterActions(
  isCourseSession: boolean,
  canConfigure: boolean,
  shopSlug: string,
  tripId: string,
) {
  if (isCourseSession || !canConfigure) return {};
  return {
    markTrainingDiveAction: markTrainingDiveAction.bind(null, shopSlug, tripId),
    clearTrainingDiveAction: clearTrainingDiveAction.bind(null, shopSlug, tripId),
  };
}

/**
 * The eLearning code button is offered once the course sells eLearning or the shop has pasted
 * codes in (ADR 20261120-course-elearning-codes); a course with neither has nothing to hand out.
 */
export function elearningCodesOffered(guests: {
  elearningCodes: { left: number; handedOut: number } | null;
  courseSellsElearning: boolean;
}) {
  const stock = guests.elearningCodes;
  return (
    Boolean(stock) &&
    (guests.courseSellsElearning || (stock?.left ?? 0) + (stock?.handedOut ?? 0) > 0)
  );
}
