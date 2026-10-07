/**
 * Departures — the public surface.
 *
 * This file is the whole importable contract: everything the rest of the app
 * reaches for is `@/db/trips`, never a `trips-*` sibling. The implementation is
 * split along the seams a reader actually navigates by, so a change to one of
 * them is a change to one file:
 *
 * | Sibling | What lives there |
 * | --- | --- |
 * | `./trips-create.ts` | materializing a departure — dives, meeting windows, readiness requirements |
 * | `./trips-series.ts` | recurring series: create, extend the horizon, apply details across, cancel the run |
 * | `./trips-record.ts` | one departure's own record: read it, edit details/dives/conditions/status |
 * | `./trips-schedule.ts` | the schedule builder's move / copy / remove and their refusals |
 * | `./trips-live.ts` | `liveTrip()`, the where-clause every read of `trips` carries (`pnpm check:live-trips`) |
 * | `./trips-minimum.ts` | the minimum-head-count sweep: cancel what did not fill by its own deadline |
 * | `./trips-crew.ts` | who is working it, and the guards on changing that |
 * | `./trips-clashes.ts` | two departures in each other's way: the overlap rule, and one hull on two at once |
 * | `./trips-prep.ts` | the trip-prep page's one read: crew, gear and every diver's rental fit |
 * | `./trips-roster.ts` | who is on it: bookings, wait list, contacts |
 * | `./trips-queries.ts` | reading the board: schedule lists, aggregates, calendar feeds |
 *
 * Two siblings are not here yet: `./trips-guests.ts` and `./trips-overview.ts`
 * are still imported directly by the trip pages that read them.
 *
 * Adding a function to a sibling does not publish it — name it here too. That
 * is deliberate: `trips-create.ts` in particular also exports the
 * materialization primitives its siblings share (`insertTripInstance`,
 * `resolveCourse`, …), and those must stay internal so no caller can assemble a
 * trip without the rows that make it readable as a safety document.
 */

export {
  type BoatClash,
  boatClashes,
  boatClashesByTrip,
  boatMoveClashes,
} from "./trips-clashes";
export {
  createTrip,
  type NewTrip,
  type TripDiveDraft,
  type TripScheduleDayInput,
} from "./trips-create";
export {
  type CrewClash,
  type CrewClashOnLegs,
  type CrewMoveConflicts,
  changeTripCrew,
  changeTripCrewOutcome,
  crewClashes,
  crewClashesByTrip,
  crewMoveConflicts,
  getTripCrewAssignments,
  getTripCrewIds,
  listStaff,
  type StaffPerson,
  setTripCrew,
  type TripCrewChange,
  type TripCrewMemberInput,
  type TripCrewOutcome,
  tripCrewByTrip,
} from "./trips-crew";
export { liveTrip } from "./trips-live";
export {
  cancelDeparturesBelowMinimum,
  listDeparturesAwaitingMinimumDecision,
  listMinimumNotMetRecipients,
  MINIMUM_SEATS_SWEEP_LIMIT,
  type MinimumSeatsSweepResult,
  reinstateTripClearingMinimum,
  type SweptDeparture,
} from "./trips-minimum";
export { getTripPrep, type TripPrep, type TripPrepShop } from "./trips-prep";
export {
  type CourseSessionScope,
  countShopTrips,
  listShopDayDepartures,
  listTripIdsInOfflineManifestWindow,
  listUpcomingSessionsForCourse,
  nextSessionStartByCourse,
  offsetUpcomingTripsWithCounts,
  pagedUpcomingTripsWithCounts,
  SCHEDULE_PAGE_SIZE,
  type ShopDayDeparture,
  type StaffScheduleDay,
  type StaffScheduleTrip,
  type TripWithBookedCount,
  tripDiveSiteSummaries,
  tripScheduleDayCounts,
  type UpcomingTripOffsetPage,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingStaffSchedule,
  // Unbounded whole-schedule read kept ONLY as a test fixture — never call it
  // from product code (see its docstring in trips-queries.ts).
  upcomingTripsWithCounts,
  type WeekBoardEntry,
  type WeekBoardSpan,
  weekBoard,
} from "./trips-queries";
export {
  bookedDiverLanguages,
  getShopTripTitle,
  getTripDiveSitesPeek,
  getTripWithBooked,
  listTripDives,
  listTripScheduleDays,
  type PublicCrewMember,
  setTripStatus,
  type TripConditionsPatch,
  type TripPatch,
  type TripSitePeek,
  tripCrewSpokenLanguages,
  tripPublicCrew,
  type UpdateTripOutcome,
  updateTrip,
  updateTripConditions,
} from "./trips-record";
export {
  getTripRoster,
  getTripWaitlist,
  getWaitlistEntryForTrip,
  listTripDiverContacts,
} from "./trips-roster";
export {
  type DeleteTripOutcome,
  deleteTrip,
  duplicateTrip,
  type MoveTripOutcome,
  moveTrip,
} from "./trips-schedule";
export {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  cancelOffCadenceSeriesTrips,
  createTripSeries,
  getLatestSeriesInstance,
  getTripSeriesById,
  getTripSeriesSummary,
  listOffCadenceSeriesTrips,
  type NewTripSeries,
  type OffCadenceSeriesTrip,
  rollAllSeriesForward,
  rollSeriesForward,
  type SeriesCadencePatch,
  type SeriesCadenceUpdate,
  type SeriesDetailApplyResult,
  type SeriesRollResult,
  type SeriesSweepResult,
  setSeriesRepeat,
  updateSeriesCadence,
} from "./trips-series";
