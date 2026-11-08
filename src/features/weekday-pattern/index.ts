/** weekday-pattern public contract. Internals are imported only within this module. */

export type { PatternDeparture, WeekdayDeparture, WeekdayPattern } from "./rules";
export {
  PATTERN_MIN_AGREEING,
  PATTERN_WEEKS,
  patternDives,
  patternSiteFields,
  weekdayPattern,
} from "./rules";
export { departuresOnWeekday, weekdayPatternFor } from "./store";
