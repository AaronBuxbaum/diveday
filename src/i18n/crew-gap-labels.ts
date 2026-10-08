import { type CourseCrewGap, DSD_RATIO } from "@/lib/course-ratios";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

type OverRatio = Extract<CourseCrewGap, { code: "over_ratio" }>;

/**
 * **The trip page's over-ratio sentence.** Two rules, two sentences: the
 * entry-level cap is PADI's published Open Water training figure and a
 * certified assistant raises it; the intro cap is PADI's tighter published
 * Discover Scuba open-water figure (HD-6) that an assistant does not move. One
 * generic string told a DSD manager to add a divemaster, which cannot work, and
 * cited the wrong PADI number at them. The per-instructor figure is
 * interpolated from `DSD_RATIO` so the sentence cannot drift away from the cap
 * the gate actually enforces. Past the 12-per-instructor ceiling an assistant
 * buys no seat, so that case names an instructor (issue #1677).
 */
export function overRatioWarningText(t: StaffTranslator, gap: CourseCrewGap): string | null {
  if (gap.code !== "over_ratio") return null;
  const counts = { booked: gap.booked, cap: gap.capacity };
  if (gap.ratio === "intro") {
    return t("trips.detail.overRatioWarningIntro", {
      ...counts,
      perInstructor: DSD_RATIO.openWaterStudentsPerInstructor,
    });
  }
  return gap.remedy === "instructor"
    ? t("trips.detail.overRatioWarningCeiling", counts)
    : t("trips.detail.overRatioWarning", counts);
}

/**
 * **Who to go and find**, as the trip pulse's chip says it (issue #1677): a
 * divemaster or AI raises the student cap up to 12 per instructor, and adds
 * nothing past that or to an intro session.
 */
export function overRatioPulseKey(gap: OverRatio): StaffMessageKey {
  if (gap.ratio === "intro") return "trips.pulse.overIntroRatio";
  return gap.remedy === "instructor" ? "trips.pulse.overRatioInstructor" : "trips.pulse.overRatio";
}
