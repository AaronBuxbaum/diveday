import type { StaffTranslator } from "@/i18n/staff-messages";
import type { WeekBoardCopy } from "./WeekBoard";

/**
 * The words the week board says about a day itself rather than about a
 * departure: an empty day, a run of past empty days folded into one row, and
 * a day a diver asked for.
 */
export function weekDayCopy(
  st: StaffTranslator,
): Pick<WeekBoardCopy, "noBoats" | "quietDays" | "asked"> {
  return {
    noBoats: st("schedule.week.noBoats"),
    quietDays: st.raw("schedule.week.quietDays"),
    asked: st("schedule.week.asked"),
  };
}
