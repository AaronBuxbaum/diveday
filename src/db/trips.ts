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
 * | `./trips-manifest.ts` | who is on it: bookings, wait list, contacts |
 * | `./trip-primary-site.ts` | `tripPrimarySiteId`, the one projection of `trip_dives` to "the trip's site" |
 * | `./trips-queries.ts` | reading the board: schedule lists, aggregates, calendar feeds |
 *
 * The trip page's surface readers (`trip-page.ts`, over `trip-overview.ts`,
 * `trip-guests.ts` and their `trip-shared-reads.ts`; `trip-prep.ts`) are not
 * part of the aggregate: they answer one page each and are imported by name.
 *
 * Nothing outside `src/db` imports a `trips-*` sibling directly
 * (`check:architecture`); the db siblings import each other by file so the
 * barrel never sits in a cycle.
 *
 * Adding a function to a sibling does not publish it — name it here too. That
 * is deliberate: `trips-create.ts` in particular also exports the
 * materialization primitives its siblings share (`insertTripInstance`,
 * `resolveCourse`, …), and those must stay internal so no caller can assemble a
 * trip without the rows that make it readable as a safety document.
 */

export { tripPrimarySiteId, tripVisitsSite } from "./trip-primary-site";
export {
  type BoatClash,
  boatClashes,
  boatClashesByTrip,
  boatMoveClashes,
} from "./trips-clashes";
export {
  createTrip,
  createTripOrRefusal,
  type NewTrip,
  type TripBoatOutOfService,
  type TripDiveDraft,
  type TripScheduleDayInput,
} from "./trips-create";
export {
  type CrewClash,
  type CrewClashOnLegs,
  type CrewMoveConflicts,
  changeTripCrew,
  changeTripCrewOutcome,
  countCrewDeparturesNotHome,
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
export { liveTrip, notRehearsal } from "./trips-live";
export { getTripRoster, listTripDiverContacts } from "./trips-manifest";
export {
  cancelDeparturesBelowMinimum,
  listDeparturesAwaitingMinimumDecision,
  listMinimumNotMetRecipients,
  MINIMUM_SEATS_SWEEP_LIMIT,
  type MinimumSeatsSweepResult,
  type ReinstateTripOutcome,
  reinstateTrip,
  type SweptDeparture,
} from "./trips-minimum";
export {
  type CourseSessionScope,
  countShopTrips,
  heldSeatCounts,
  listShopDayDepartures,
  listTripIdsInOfflineManifestWindow,
  listUpcomingSessionsForCourse,
  nextSessionStartByCourse,
  offsetUpcomingTripsWithCounts,
  pagedUpcomingTripsWithCounts,
  SCHEDULE_PAGE_SIZE,
  type ShopDayDeparture,
  seatNotCancelled,
  type TripWithBookedCount,
  tripDiveSiteSummaries,
  tripScheduleDayCounts,
  type UpcomingTripOffsetPage,
  upcomingScheduleRange,
  upcomingScheduleStats,
  // Unbounded whole-schedule read kept ONLY as a test fixture — never call it
  // from product code (see its docstring in trips-queries.ts).
  upcomingTripsWithCounts,
  type WeekBoardEntry,
  type WeekBoardSpan,
  weekBoard,
} from "./trips-queries";
export {
  bookedDiverLanguages,
  editTrip,
  editTripConditions,
  editTripSection,
  getShopTripTitle,
  getTripDiveSitesPeek,
  getTripMeetingPointFields,
  getTripWithBooked,
  getTripWithBookedOnce,
  listTripDives,
  listTripScheduleDays,
  offlineSyncTripsBelongToShop,
  type PublicCrewMember,
  type SetParticipantTermsOutcome,
  setTripParticipantTerms,
  setTripStatus,
  type TripConditionsPatch,
  type TripPatch,
  type TripSitePeek,
  tripCrewSpokenLanguages,
  tripPublicCrew,
  type UpdateTripOutcome,
} from "./trips-record";
export {
  type CopyWeekOutcome,
  copyWeekFromYearBefore,
  type DeleteTripOutcome,
  DUPLICATE_BOAT_OUT_OF_SERVICE,
  deleteTrip,
  departuresWeekBefore,
  duplicateTrip,
  duplicateTripOrRefusal,
  type MoveTripOutcome,
  moveTrip,
} from "./trips-schedule";
export {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  cancelOffCadenceSeriesTrips,
  createTripSeries,
  createTripSeriesOrRefusal,
  editSeriesCadence,
  getLatestSeriesInstance,
  getSeriesStandingCrew,
  getTripSeriesById,
  getTripSeriesSummary,
  isSeriesBoatOutOfService,
  listOffCadenceSeriesTrips,
  listRunningPublicSeries,
  type NewTripSeries,
  type OffCadenceSeriesTrip,
  type RunningPublicSeries,
  rollAllSeriesForward,
  rollSeriesForward,
  type SeriesBoatOutOfService,
  type SeriesCadencePatch,
  type SeriesCadenceUpdate,
  type SeriesCancelResult,
  type SeriesCrewApplyResult,
  type SeriesDetailApplyResult,
  type SeriesRollResult,
  type SeriesSweepResult,
  type SeriesYardLine,
  setSeriesRepeat,
  setSeriesStandingCrew,
} from "./trips-series";
