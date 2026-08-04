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
 * | `./trips-crew.ts` | who is working it, and the guards on changing that |
 * | `./trips-roster.ts` | who is on it: bookings, wait list, contacts |
 * | `./trips-queries.ts` | reading the board: schedule lists, aggregates, calendar feeds |
 *
 * Adding a function to a sibling does not publish it — name it here too. That
 * is deliberate: `trips-create.ts` in particular also exports the
 * materialization primitives its siblings share (`insertTripInstance`,
 * `resolveCourse`, …), and those must stay internal so no caller can assemble a
 * trip without the rows that make it readable as a safety document.
 */

export {
  createTrip,
  type NewTrip,
  type TripDiveDraft,
  type TripScheduleDayInput,
} from "./trips-create";
export {
  changeTripCrew,
  getTripCrewAssignments,
  getTripCrewIds,
  listStaff,
  setTripCrew,
  type TripCrewChange,
  type TripCrewMemberInput,
  tripCrewByTrip,
} from "./trips-crew";
export {
  listTripIdsInOfflineManifestWindow,
  listUpcomingSessionsForCourse,
  offsetUpcomingTripsWithCounts,
  pagedUpcomingTripsWithCounts,
  SCHEDULE_PAGE_SIZE,
  type StaffScheduleDay,
  type StaffScheduleTrip,
  type TripWithBookedCount,
  tripScheduleDayCounts,
  type UpcomingTripOffsetPage,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingStaffSchedule,
  upcomingTripsForCalendar,
  upcomingTripsWithCounts,
} from "./trips-queries";
export {
  getTripDiveSitesPeek,
  getTripWithBooked,
  listTripDives,
  listTripScheduleDays,
  setTripStatus,
  type TripConditionsPatch,
  type TripPatch,
  type TripSitePeek,
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
  createTripSeries,
  type ExtendTripSeriesInput,
  extendTripSeries,
  getLatestSeriesInstance,
  getTripSeriesById,
  getTripSeriesSummary,
  type NewTripSeries,
  type SeriesDetailApplyResult,
} from "./trips-series";
