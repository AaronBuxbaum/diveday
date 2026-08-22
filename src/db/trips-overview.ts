import { HOUR_MS, nowDate } from "@/lib/clock";
import { courseCrewGap } from "@/lib/course-ratios";
import { countInWaterCrew } from "@/lib/crew-roles";
import { divemasterRatioGap, inWaterDivemasterCount } from "@/lib/divemaster-ratio";
import { rentalFitCompleteness } from "@/lib/rentals";
import { rosterRowIsBlocked } from "@/lib/roster-filters";
import { summarizeTripDiveSites } from "@/lib/trip-dives";
import { utcToWallTime } from "@/lib/zoned";
import { canPersonConfigureTrips } from "./authz";
import { hasTripBlowout } from "./blowouts";
import type { AppDb } from "./client";
import { listDiveSites } from "./dive-sites";
import { listDepartureBoardedByTrip } from "./manifests";
import { countOpenTripOrders } from "./orders";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "./readiness";
import { listTripPrepDivers } from "./rental-fit";
import { crewShiftCoverage } from "./staffing";
import {
  getTripCrewAssignments,
  getTripSeriesSummary,
  getTripWithBooked,
  listOffCadenceSeriesTrips,
  listStaff,
  listTripDives,
  listTripScheduleDays,
} from "./trips";

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
};

export type TripOverview = Awaited<ReturnType<typeof getTripOverview>>;

export async function getTripOverview(
  db: AppDb,
  shop: TripOverviewShop,
  tripId: string,
  actorPersonId: string,
  now: Date = nowDate(),
) {
  const trip = await getTripWithBooked(db, shop.id, tripId);
  if (!trip) return null;

  const cancelled = trip.status === "cancelled";
  // "Is this trip behind us?" — with the hour of grace every has-it-ended check
  // carries (the close-out's readiness gate and Today's "home" both add it):
  // boats run late, and the pulse dying at the scheduled minute told a staffer
  // watching a boat still out that there was nothing left to watch. A cancelled
  // departure never sailed at all.
  const departed = !cancelled && trip.endsAt.getTime() + HOUR_MS <= now.getTime();
  // The pulse — the state-of-the-boat strip that opens the page — only beats for
  // a departure that is still ahead: a cancelled or departed trip has no seats to
  // fill or blockers to clear.
  const pulseNeeded = !cancelled && !departed;

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
    pulseReadiness,
    pulsePrepDivers,
    pulseBoardedByTrip,
    pulseOpenOrders,
  ] = await Promise.all([
    listStaff(db, shop.id),
    getTripCrewAssignments(db, shop.id, tripId),
    getTripRequirements(db, shop.id, tripId),
    listDiveSites(db, shop.id),
    listTripDives(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
    getTripSeriesSummary(db, shop.id, tripId),
    listTripScheduleDays(db, shop.id, tripId),
    canPersonConfigureTrips(db, shop.id, actorPersonId),
    // Whether this trip's cancellation was a called blow-out — the cascade record
    // is the surface a weather morning is worked from, so the trip page must
    // always offer the way back to it (ADR 20260804-blowout-cascade).
    hasTripBlowout(db, shop.id, tripId),
    // The pulse's facts, read only while the trip is still ahead. All go through
    // the readers their destination surfaces already trust — the roster's own
    // blocked predicate, the prep list's own completeness rule, and the
    // manifest's own boarded reader — so the counts on this strip can never
    // disagree with the pages it links to.
    pulseNeeded ? listTripReadiness(db, shop.id, tripId) : [],
    pulseNeeded ? listTripPrepDivers(db, shop.id, tripId) : [],
    pulseNeeded
      ? listDepartureBoardedByTrip(db, shop.id, [tripId])
      : new Map<string, Set<string>>(),
    // …and the third question a staffer asks of an upcoming boat, after "can
    // everyone board" and "can the packer pack": is anyone still owing money for
    // it. `countOpenTripOrders` asks the Orders index's own question so this
    // number and the filtered index the fact opens can never disagree.
    pulseNeeded ? countOpenTripOrders(db, shop.id, tripId) : 0,
  ]);

  // Only ever non-empty right after staff narrowed this run's cadence, and only
  // for someone who can act on it — a second query rather than a field on the
  // summary, because it is the one thing here that costs a join and is empty
  // almost always.
  const offCadence =
    canConfigure && series ? await listOffCadenceSeriesTrips(db, shop.id, series.id) : [];

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
  const pulse = {
    blocked: pulseReadiness.filter((row) => rosterRowIsBlocked(row.readiness)).length,
    prepGaps: pulsePrepDivers.filter(
      (diver) => rentalFitCompleteness(diver.fit, shop.rentalItems).state !== "complete",
    ).length,
    boarded: pulseBoardedByTrip.get(tripId)?.size ?? 0,
    openOrders: pulseOpenOrders,
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
  const inWaterCrew = countInWaterCrew(
    assignedCrew.map((entry) => ({
      tripRole: tripRoleByPerson.get(entry.person.id) ?? null,
      shopRoles: entry.roles,
    })),
  );
  // `courseCrewGap` is the one computation of "does this course session have
  // enough crew", also consumed by the staffing coverage list and the Today
  // queue — `over_ratio` is the visible nudge to fix a ratio-gated session before
  // sailing, never a retroactive block on the bookings already taken.
  const crewGap = courseCrewGap({ course: trip.course, ...inWaterCrew, booked: trip.booked });
  // The shop's own target, measured off the same crew count and reported
  // separately from the two agency gates above — it applies to every departure,
  // course or fun dive, and it refuses nothing.
  const ratioGap = divemasterRatioGap({
    divers: trip.booked,
    divemasterCount: inWaterDivemasterCount(inWaterCrew),
    diversPerDivemaster: shop.diversPerDivemaster,
  });

  // The other half of the shift <-> crew cross-link: whether each assigned crew
  // member actually has a working shift covering this sailing. `null` — the shop
  // has never scheduled a shift — means the question doesn't apply.
  const shiftCoverage = await crewShiftCoverage(db, shop.id, trip, crewIds);

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
    crew: {
      crewIds,
      tripRoleByPerson,
      inWaterCrew,
      crewGap,
      ratioGap,
      onShiftIds: shiftCoverage === null ? null : [...shiftCoverage],
    },
  };
}
