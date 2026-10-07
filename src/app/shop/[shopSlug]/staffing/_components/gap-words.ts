import type { StaffTranslator } from "@/i18n/staff-messages";
import type { GapWords } from "./StaffingWeek";

/** The staffing week's word for each crew gap, at chip length. */
export function staffingGapWords(t: StaffTranslator): GapWords {
  // One vocabulary, not two: every word here already belongs to a surface that
  // can fix the gap — Today's chip labels for the shop's own target, the trip
  // pulse's for the agency training ratio. The staffing week owns no crew
  // vocabulary of its own (ADR 20260806-staffing-is-the-shift-roster).
  //
  // All five now read at chip length. The two pulse keys were whole sentences
  // written for the trip page, where a full-width row has all the space a
  // sentence wants; here the day column is about 135px and "This course
  // session has no instructor yet" took four lines beside "No crew" (#1125).
  //
  // `uncrewed_course` is the one that has to say two things in that column
  // (issue #1338): a course session with nobody in the water needs an
  // instructor *and* has nobody supervising, and a chip saying only the second
  // sends a manager to phone any divemaster, who cannot close the first.
  //
  // `over_intro_ratio` is the second one that has to say a different thing in
  // that column (issue #1339): "Over student ratio" is a true sentence about
  // an intro session and a useless one, because the cap it names is
  // instructor-to-student and the divemaster it invites raises it by nothing.
  return {
    no_instructor: t("trips.pulse.needsInstructor"),
    over_ratio: t("trips.pulse.overRatio"),
    over_intro_ratio: t("trips.pulse.overIntroRatio"),
    over_ratio_instructor: t("trips.pulse.overRatioInstructor"),
    uncrewed_course: t("today.actionKind.uncrewedCourse"),
    uncrewed_departure: t("today.actionKind.uncrewedDeparture"),
    crew_below_target: t("today.actionKind.crewBelowTarget"),
  };
}
