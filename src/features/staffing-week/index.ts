/** staffing-week public contract. Internals are imported only within this module. */
export type {
  CrewClash,
  CrewGap,
  PersonWeekTotals,
  PlacedGap,
  PlacedGapRequest,
  PlacedTrip,
  StaffGapCode,
  StaffWeek,
  StaffWeekDay,
  StaffWeekGapDay,
  StaffWeekPerson,
  StaffWeekPersonDay,
  TripMeeting,
  WeekCrewing,
  WeekGap,
  WeekPerson,
  WeekShift,
} from "./rules";
export {
  clashingDepartures,
  crewGapFor,
  GAP_TONE,
  personWeekTotals,
  sayEachClashOnce,
  staffGapForCourseGap,
  staffWeek,
} from "./rules";
