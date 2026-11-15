/**
 * today — the shop home's work queue, its day spine and the evening close-out:
 * the one module that reads every other one (ADR 20260720-today-work-queue,
 * ADR 20260804-day-closeout).
 *
 * This file is the module's entire public surface: nothing outside
 * `src/features/today/` may import its internals, and `pnpm check:architecture`
 * enforces that. See ./README.md for the contract.
 */

export {
  assembleEveningClose,
  CLOSEOUT_STATUS_TONES,
  type CloseoutDeparture,
  type DayCloseoutState,
  type DayTakings,
  dayTakings,
  type EveningClose,
  type StationClose,
  tomorrowNoon,
} from "./closeout";
export {
  getDayCloseout,
  getPastDay,
  listHeadCountCloses,
  listNotBackAfterDive,
  readDayLoadOut,
  shopHasSailedBefore,
} from "./closeout-reader";
export type { CrewReading } from "./day-money";
export { getDayPrintPage } from "./day-print-page";
export { pastDayStationNotes } from "./past-day-notes";
export {
  canAcceptPayments,
  daySummaryBlocked,
  getHomeShop,
  getShopHome,
  type HomeShop,
} from "./shop-home";
export {
  ACTION_KIND_META,
  assembleDaySpine,
  type DaySpine,
  type DayStation,
  diverBlockerAction,
  type FactOfScale,
  factOfScaleFor,
  groupByDeparture,
  type NeedsYouReading,
  readNeedsYou,
  roleLensFor,
  rowTone,
  type SpineDeparture,
  sortStationRows,
  spineIsQuiet,
  spineJobCount,
  type TodayAction,
  weekCrewAway,
} from "./today";
export { getDepartureNeeds } from "./today-departure-needs";
export {
  type CrewedSessionSummary,
  countBlockedDiversNextBoatDay,
  getShopDayDepartures,
  getTodayWork,
  nextOfTodaysDepartures,
  todayNextDepartureTripId,
  todaysDepartures,
  withAgencyChecks,
} from "./today-reader";
