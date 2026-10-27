import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import { crewLanguageBriefings } from "@/lib/crew-languages";
import {
  countBothClaims,
  lapsedRungs,
  lastDayOfDeparture,
  narrowedByLapse,
  rungLostToUnverified,
  unverifiedRungs,
} from "@/lib/crew-roles";
import { shopCrewTarget } from "@/lib/crew-schedule";
import { divemasterRatioGap, inWaterDivemasterCount } from "@/lib/divemaster-ratio";
import { rosterRowIsBlocked } from "@/lib/roster-filters";
import { summarizeTripDiveSites } from "@/lib/trip-dives";
import { hasReturned } from "@/lib/trips";
import { utcToWallTime } from "@/lib/zoned";
import { canPersonConfigureTrips } from "./authz";
import { tripBlowoutCause } from "./blowouts";
import { type BoatWork, boatWorkFor, readBoatWork } from "./boat-work";
import type { AppDb } from "./client";
import { listCrewAwayAcknowledgements } from "./crew-away-acknowledgements";
import { listDiveSites } from "./dive-sites";
import { flySafeToldUncorrected } from "./fly-safe-correction";
import { listDepartureBoardedByTrip } from "./manifests";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "./readiness";
import { ratingCredentialsByPerson } from "./staff-credentials";
import { crewShiftCoverage } from "./staffing";
import { boatClashes } from "./trips-clashes";
import { crewClashes, getTripCrewAssignments, listStaff } from "./trips-crew";
import {
  bookedDiverLanguages,
  getTripWithBooked,
  listTripDives,
  listTripScheduleDays,
} from "./trips-record";
import { getTripSeriesSummary, listOffCadenceSeriesTrips } from "./trips-series";
import type { TripSharedReads } from "./trips-shared-reads";

/**
 * Everything the trip's Overview page is about, in one call — the third of the
 * five trip surfaces to get the reader `getTripManifests` established.
 *
 * What is deliberately **not** here: the page's sentences. The pulse caption,
 * the over-ratio warning, the under-target note and the identity line under the
 * date are all `t(...)` calls over these numbers, and `src/db` returns codes and
 * data, never sentences (AGENTS.md). Issue #632 lists the identity facts as
 * something to move; they are JSX carrying translated copy and links, so what
 * moved is the data they read — `diveSites`, `series`, the course on the trip —
 * and the markup stayed where the translator is.
 *
 * Takes the shop row rather than a shop id, like `getTripPrep`: the caller has
 * already resolved it through `requireShopSurface`, so this removes a duplicate
 * round-trip rather than adding one.
 *
 * Returns `null` when the trip is absent so the page keeps its own `notFound()`.
 */

export type TripOverviewShop = {
  id: string;
  timezone: string;
  rentalItems: string[];
  diversPerDivemaster: number;
  /** Whether the shop plans its crew here (`src/lib/crew-schedule.ts`). */
  crewScheduleEnabled: boolean;
  /** The shop's own language, which every briefing is already in (item 48). */
  defaultLocale: string;
};

export type TripOverview = Awaited<ReturnType<typeof getTripOverview>>;

export async function getTripOverview(
  db: AppDb,
  shop: TripOverviewShop,
  tripId: string,
  actorPersonId: string,
  now: Date = nowDate(),
  /**
   * The five reads the trip page shares with `getTripGuests`
   * (`./trips-shared-reads`), when the caller has them in hand or in flight.
   * Omitted, this reads its own, as the print packet's call does.
   */
  sharedReads?: TripSharedReads | null | Promise<TripSharedReads | null>,
) {
  const shared = await sharedReads;
  // Handed reads that found no departure: the answer is already in.
  if (sharedReads !== undefined && shared === null) return null;
  const trip = shared ? shared.trip : await getTripWithBooked(db, shop.id, tripId);
  if (!trip) return null;

  const cancelled = trip.status === "cancelled";
  // "Is this trip behind us?" — with the hour of grace every has-it-ended check
  // carries (the close-out's readiness gate and Today's "home" both add it):
  // boats run late, and the pulse dying at the scheduled minute told a staffer
  // watching a boat still out that there was nothing left to watch. A cancelled
  // departure never sailed at all.
  const departed = !cancelled && hasReturned(trip.endsAt, now);
  // The pulse — the state-of-the-boat strip that opens the page — only beats for
  // a departure that is still ahead: a cancelled or departed trip has no seats to
  // fill or blockers to clear.
  const pulseNeeded = !cancelled && !departed;

  // Every read below is one wave. The reads that wait on an answer from it —
  // the crew's ratings and shifts on who is crewing, the off-cadence list on
  // the series and the permission — chain off their own input inside the wave
  // rather than after the whole of it (issue #2353), and the two clash reads
  // need nothing but the departure.
  const crewAssignmentsRead = getTripCrewAssignments(db, shop.id, tripId);
  const canConfigureRead = canPersonConfigureTrips(db, shop.id, actorPersonId);
  const seriesRead = getTripSeriesSummary(db, shop.id, tripId);
  const crewEvidenceRead = crewAssignmentsRead.then(async (assignments) => {
    const ids = assignments.map((entry) => entry.personId);
    const [credentials, shiftCoverage] = await Promise.all([
      ratingCredentialsByPerson(db, shop.id, ids),
      // No shifts exist to cover anybody while the crew schedule is off.
      shop.crewScheduleEnabled ? crewShiftCoverage(db, shop.id, trip, ids) : null,
    ]);
    return { credentials, shiftCoverage };
  });
  // Only ever non-empty right after staff narrowed this run's cadence, and only
  // for someone who can act on it — a second query rather than a field on the
  // summary, because it is the one thing here that costs a join and is empty
  // almost always.
  const offCadenceRead = Promise.all([canConfigureRead, seriesRead]).then(
    ([mayConfigure, summary]) =>
      mayConfigure && summary ? listOffCadenceSeriesTrips(db, shop.id, summary.id) : [],
  );

  const pulseReadinessRead = pulseNeeded
    ? Promise.resolve(shared?.readiness ?? listTripReadiness(db, shop.id, tripId))
    : Promise.resolve([]);

  const [
    staff,
    crewAssignments,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
    blowoutCalled,
    diverLanguages,
    pulseReadiness,
    pulseWork,
    pulseBoardedByTrip,
    crewEvidence,
    offCadence,
    clashes,
    hullClashes,
    crewAwayWorking,
  ] = await Promise.all([
    listStaff(db, shop.id),
    crewAssignmentsRead,
    shared ? shared.requirement : getTripRequirements(db, shop.id, tripId),
    listDiveSites(db, shop.id),
    listTripDives(db, shop.id, tripId),
    shared ? shared.siteRequirement : getTripSiteRequirement(db, shop.id, tripId),
    seriesRead,
    listTripScheduleDays(db, shop.id, tripId),
    canConfigureRead,
    // Whether this trip's cancellation was a called blow-out — the cascade record
    // is the surface a weather morning is worked from, so the trip page must
    // always offer the way back to it (ADR 20260804-blowout-cascade).
    tripBlowoutCause(db, shop.id, tripId),
    bookedDiverLanguages(db, shop.id, tripId),
    // The pulse's facts, read only while the trip is still ahead. All go through
    // the readers their destination surfaces already trust — the roster's own
    // blocked predicate, the prep list's own completeness rule, and the
    // manifest's own boarded reader — so the counts on this strip can never
    // disagree with the pages it links to.
    pulseReadinessRead,
    // The boat's work — sizes, nitrox, contacts, open orders — through the
    // one reader Today's rows for this boat read (`./boat-work`), over the
    // same seats, so the band and Today can never count it differently
    // (third review, item 4).
    pulseReadinessRead.then((rows) =>
      pulseNeeded
        ? readBoatWork(db, shop.id, new Map([[tripId, rows.map((row) => row.booking.id)]]))
        : new Map<string, BoatWork>(),
    ),
    pulseNeeded
      ? listDepartureBoardedByTrip(db, shop.id, [tripId])
      : new Map<string, Set<string>>(),
    crewEvidenceRead,
    offCadenceRead,
    // Who on this crew is on another departure whose hours overlap this one,
    // and the hull's own clash — see the crew panel's note below.
    crewClashes(db, shop.id, trip.id),
    boatClashes(db, shop.id, trip.id),
    // Who a staffer said is working it anyway (#2678), so the crew panel can
    // take it back; only while the boat is still ahead.
    pulseNeeded ? listCrewAwayAcknowledgements(db, shop.id, trip.id) : [],
  ]);

  // Where this departure goes, composed from the dives already loaded above — no
  // second query, and the same answer the public schedule card gives.
  const diveSites = summarizeTripDiveSites(
    tripDiveList.map(({ dive, diveSite }) => ({
      diveNumber: dive.diveNumber,
      site: diveSite ? { id: diveSite.id, name: diveSite.name } : null,
    })),
  );

  const startWall = utcToWallTime(trip.startsAt, shop.timezone);
  // Day one's window, not the trip's whole span: a multi-day departure ends on
  // its *last* day, and the details editor's Departs/Returns boxes describe one
  // day that the day count then repeats.
  const firstDay = scheduleDays[0];
  const endWall = utcToWallTime(firstDay?.endsAt ?? trip.endsAt, shop.timezone);

  // How the boat stands, in the pulse's terms: who still can't board (the roster
  // chips' own rule) and whose rental fit the packer can't pack from yet (the
  // prep list's own rule).
  const work = boatWorkFor(pulseWork, tripId);
  const pulse = {
    blocked: pulseReadiness.filter((row) => rosterRowIsBlocked(row.readiness)).length,
    boarded: pulseBoardedByTrip.get(tripId)?.size ?? 0,
    /** The boat's work as counts, for `boatWorkItems` (src/lib/boat-work.ts). */
    work: {
      missingSize: work.missingSize.length,
      kitUnasked: work.kitUnasked.length,
      ungatedNitrox: work.ungatedNitrox.length,
      missingContact: work.missingContact.length,
      openOrders: work.openOrders,
    },
  };

  const crewIds = crewAssignments.map((entry) => entry.personId);
  const tripRoleByPerson = new Map(
    crewAssignments.map((entry) => [entry.personId, entry.tripRole] as const),
  );
  const assignedCrew = staff.filter((entry) => crewIds.includes(entry.person.id));
  // Who counts as an instructor or an in-water certified assistant is
  // `countInWaterCrew` (src/lib/crew-roles.ts) — one definition shared with the
  // booking gate, the staffing window, and Today, so a divemaster rostered as
  // this trip's captain stops buying two students' worth of capacity here too
  // (DOM-M3).
  //
  // This page states the supervision claim, so it reads each rostered
  // professional's recorded ratings against the departure's last shop-local
  // day, as Today and the staffing week do (issue #1853). The booking gate on
  // this same trip does not: it sells on the roster's claim (H-59).
  const { credentials, shiftCoverage } = crewEvidence;
  const divesOn = lastDayOfDeparture(trip.endsAt, shop.timezone);
  const firstCrewDay = calendarDateInTimezone(trip.startsAt, shop.timezone);
  const crewMembers = assignedCrew.map((entry) => ({
    person: entry.person,
    tripRole: tripRoleByPerson.get(entry.person.id) ?? null,
    shopRoles: entry.roles,
    lapsedRungs: lapsedRungs(credentials.get(entry.person.id) ?? [], divesOn, firstCrewDay),
    unverifiedRungs: unverifiedRungs(credentials.get(entry.person.id) ?? [], firstCrewDay),
  }));
  const { supervision: inWaterCrew, roster: rosterInWaterCrew } = countBothClaims(crewMembers);
  // Who a lapse took down a rung, so the Crew panel can say why a list that
  // names an instructor still reads as short.
  const lapsedCrew = crewMembers
    .filter(narrowedByLapse)
    .map((member) => ({ personId: member.person.id, fullName: member.person.fullName }));
  const unverifiedCrew = crewMembers
    .filter((member) => rungLostToUnverified(member) !== null)
    .map((member) => ({ personId: member.person.id, fullName: member.person.fullName }));
  // `courseCrewGap` is the one computation of "does this course session have
  // enough crew", also consumed by the staffing coverage list and the Today
  // queue — `over_ratio` is the visible nudge to fix a ratio-gated session before
  // sailing, never a retroactive block on the bookings already taken.
  // Its students are its divers (G5 of #2226).
  const crewGap = courseCrewGap({ course: trip.course, ...inWaterCrew, booked: trip.bookedDivers });
  // The shop's own target, measured off the same crew count and reported
  // separately from the two agency gates above — it applies to every departure,
  // course or fun dive, and it refuses nothing.
  const ratioGap = divemasterRatioGap({
    // Divers only (ADR 20261007-participant-types): a snorkeler or a rider is
    // aboard, not supervised underwater.
    divers: trip.bookedDivers,
    divemasterCount: inWaterDivemasterCount(inWaterCrew),
    diversPerDivemaster: shopCrewTarget(shop),
    // A departure the shop has marked self-guided is never short of its own
    // target — the whole point of the mark (issue #973).
    selfGuided: trip.selfGuided,
  });
  // Same stance as ratioGap above: informs, refuses nothing (issue #708).
  // Diver languages come only from a first-hand signal (`bookedDiverLanguages`
  // above), so a trip full of divers with no stated preference correctly
  // reports no gap rather than flagging every crew that never recorded
  // English.
  // A shop that keeps no roster is not told nobody aboard speaks German: its
  // crew list is not where it records who sails.
  // Which divers read each language, and who on this crew speaks it
  // (fifth-loop ideas, item 48).
  const languageBriefings = shop.crewScheduleEnabled
    ? crewLanguageBriefings({
        crew: assignedCrew.map((entry) => ({
          name: entry.person.fullName,
          languages: entry.person.spokenLanguages,
        })),
        divers: diverLanguages,
        shopLanguage: (shop.defaultLocale ?? "").split("-")[0] ?? "",
      })
    : { uncovered: [], covered: [] };

  // The other half of the shift <-> crew cross-link: whether each assigned crew
  // member actually has a working shift covering this sailing. `null` — the shop
  // has never scheduled a shift — means the question doesn't apply.
  //
  // Beside it, the clash the crew panel had no way to know about (issue #1695):
  // who on this crew is on another departure whose hours overlap this one. No
  // write door will *create* it — `setTripCrew` and `changeTripCrew` both
  // refuse — so it arrives from a write that moves the boat without reading the
  // roster, and there are three of those rather than the one `moveTrip` this
  // comment used to name (`crewClashes`' own docblock, "Three doors, not one").
  //
  // And the hull's own (H-80, issue #1780): one boat, one departure at a time,
  // asked by the same overlap predicate. The Details form writes `boat_id` and
  // the window with no read of either, so this is the only place that door
  // gets an answer.
  // (All three are read in the wave above.)

  return {
    trip,
    cancelled,
    pulseNeeded,
    staff,
    requirement,
    diveSiteList,
    tripDiveList,
    siteRequirement,
    series,
    scheduleDays,
    canConfigure,
    blowoutCalled,
    offCadence,
    diveSites,
    startWall,
    endWall,
    pulse,
    /**
     * Seats the night-before email told a fly-safe wait and nobody has
     * corrected yet (#2927): the Details form warns beside the decompression
     * box. Read off the pulse's seats, so only while the trip is ahead.
     */
    flySafeTold: flySafeToldUncorrected(pulseReadiness.map((row) => row.booking)),
    boatClashes: hullClashes,
    crew: {
      crewIds,
      tripRoleByPerson,
      inWaterCrew,
      rosterInWaterCrew,
      lapsedCrew,
      unverifiedCrew,
      crewGap,
      ratioGap,
      languageBriefings,
      onShiftIds: shiftCoverage === null ? null : [...shiftCoverage],
      clashes,
      awayWorking: crewAwayWorking,
    },
  };
}
