import { and, asc, count, eq, gte, inArray, lt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { groupCrewAssignments } from "@/lib/crew-roles";
import {
  type AutomatedMarineForecast,
  fetchAutomatedMarineForecast,
  type SeaState,
  seaStateReading,
  shouldShowAutomatedForecast,
  type WindState,
  windReading,
} from "@/lib/marine-forecast";
import { liveStageOf, type TripStage } from "@/lib/trip-stages";
import { shopDayBounds } from "@/lib/zoned";
import type { AppDb } from "./client";
import { listDepartureRollCallByTrip } from "./manifests";
import { boats, bookings, diveSites, people, personRoles, tripAssignments, trips } from "./schema";
import { latestTripStagesByTrip } from "./trip-stages";
import { liveTrip } from "./trips-live";
import { liveBookingJoin } from "./trips-queries";

/**
 * **The departures board's one reader** — what a lobby TV or a dock tablet may
 * know about today (issue #1426, N-23).
 *
 * This is the shop home's day spine read in a *read-only shape*: the same
 * `liveTrip()` + `scheduled` scope the offline-manifest window uses, the same
 * seat predicate the schedule counts with (`liveBookingJoin`), the same
 * roll-call reader (`listDepartureRollCallByTrip`), the same stage reader
 * (`latestTripStagesByTrip`) and the same staleness rule (`liveStageOf`). It
 * detects nothing of its own — no readiness, no blockers, no queue — because
 * a second detector is how two surfaces come to disagree about one boat.
 *
 * What it will never carry, by type: a diver's name, a phone number, a
 * readiness state, a price, or who tapped the stage word. `boardShapeIsClosed`
 * in `departures-board.test.ts` pins the key set, so widening this type is a
 * failing test rather than a quiet leak onto a public screen.
 */
export type BoardOutlook = {
  waterTemperatureC: number | null;
  seaState: SeaState | null;
  windState: WindState | null;
};

export type BoardDeparture = {
  tripId: string;
  title: string;
  /** A private charter is never named on the board — see `boardTitleFor`. */
  isPrivate: boolean;
  startsAt: Date;
  endsAt: Date;
  siteName: string | null;
  boatName: string | null;
  capacity: number;
  booked: number;
  /** Divers with a `boarded` departure result — the roll call's own count. */
  boarded: number;
  /**
   * The crew's word for where the boat is, with the site it named and when.
   * Deliberately without `recordedByName`: which crew member tapped is not the
   * lobby's to read, and omitting it here makes printing it a compile error.
   */
  stage: { stage: TripStage; siteName: string | null; recordedAt: Date } | null;
  /**
   * Empty unless the link was made with `show_names` — decided here, at the
   * reader, so no page can render a crew line the link never granted.
   */
  crewNames: string[];
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
  /** The automated outlook, bands only, for a boat that has not yet left. */
  outlook: BoardOutlook | null;
};

/** The keys a board row may carry. Exported for the shape test. */
export const BOARD_DEPARTURE_KEYS = [
  "tripId",
  "title",
  "isPrivate",
  "startsAt",
  "endsAt",
  "siteName",
  "boatName",
  "capacity",
  "booked",
  "boarded",
  "stage",
  "crewNames",
  "meetingPointLabel",
  "meetingPointAddress",
  "outlook",
] as const satisfies readonly (keyof BoardDeparture)[];

function outlookOf(forecast: AutomatedMarineForecast | null): BoardOutlook | null {
  if (!forecast) return null;
  return {
    waterTemperatureC: forecast.waterTemperatureC,
    seaState: seaStateReading(forecast.surface),
    windState: windReading(forecast.wind),
  };
}

/**
 * Today's departures in clock order — the whole shop day, not the hour-buffered
 * "upcoming" stream the schedule pages: a boat that left at seven is still on
 * the board at ten, wearing the crew's stage word, until the day ends.
 */
export async function getDeparturesBoard(
  db: AppDb,
  input: { shopId: string; timeZone: string; showNames: boolean; now?: Date },
): Promise<BoardDeparture[]> {
  const now = input.now ?? nowDate();
  const day = shopDayBounds(now, input.timeZone);

  const rows = await db
    .select({
      trip: trips,
      siteName: diveSites.name,
      forecastLatitude: diveSites.forecastLatitude,
      forecastLongitude: diveSites.forecastLongitude,
      boatName: boats.name,
      booked: count(bookings.id),
    })
    .from(trips)
    // Both joins shop-scoped in their own right, not merely by way of the trip
    // row: this is printed to whoever walks into the lobby, and a widened
    // pointer once put another shop's vessel name on a board
    // (`trips.boat_id`, src/db/trips-create.ts).
    .leftJoin(
      diveSites,
      and(eq(diveSites.id, trips.diveSiteId), eq(diveSites.shopId, input.shopId)),
    )
    .leftJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, input.shopId)))
    .leftJoin(bookings, liveBookingJoin)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, input.shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, day.from),
        lt(trips.startsAt, day.to),
      ),
    )
    .groupBy(trips.id, diveSites.id, boats.id)
    .orderBy(asc(trips.startsAt), asc(trips.id));

  const tripIds = rows.map((row) => row.trip.id);
  const [rollCall, stages, crewRows] = await Promise.all([
    listDepartureRollCallByTrip(db, input.shopId, tripIds),
    latestTripStagesByTrip(db, input.shopId, tripIds),
    input.showNames && tripIds.length > 0
      ? db
          .select({
            tripId: tripAssignments.tripId,
            personId: people.id,
            fullName: people.fullName,
            tripRole: tripAssignments.tripRole,
            role: personRoles.role,
          })
          .from(tripAssignments)
          .innerJoin(
            people,
            and(eq(people.id, tripAssignments.personId), eq(people.shopId, input.shopId)),
          )
          .leftJoin(personRoles, eq(personRoles.personId, people.id))
          .where(inArray(tripAssignments.tripId, tripIds))
          // By name, for the reason the day spine gives: without it the same
          // boat reads two crew orders on two refreshes of one screen.
          .orderBy(asc(people.fullName), asc(people.id))
      : Promise.resolve([]),
  ]);

  const crewByTrip = new Map<string, string[]>();
  const namesByPerson = new Map(crewRows.map((row) => [row.personId, row.fullName] as const));
  const rowsByTrip = new Map<string, typeof crewRows>();
  for (const row of crewRows) {
    const list = rowsByTrip.get(row.tripId) ?? [];
    list.push(row);
    rowsByTrip.set(row.tripId, list);
  }
  for (const [tripId, list] of rowsByTrip) {
    crewByTrip.set(
      tripId,
      groupCrewAssignments(list).map((member) => namesByPerson.get(member.personId) ?? ""),
    );
  }

  // The outlook, for boats still to leave. `fetchAutomatedMarineForecast`
  // caches per site-hour for five minutes, so a board refreshing every
  // minute costs the provider one call per boat per five minutes at most,
  // and the e2e fleet's `DIVEDAY_DISABLE_EXTERNAL_HTTP` makes it null.
  const forecasts = await Promise.all(
    rows.map((row) =>
      row.forecastLatitude !== null &&
      row.forecastLongitude !== null &&
      shouldShowAutomatedForecast(row.trip.startsAt, now)
        ? fetchAutomatedMarineForecast(
            { latitude: row.forecastLatitude, longitude: row.forecastLongitude },
            row.trip.startsAt,
          )
        : Promise.resolve(null),
    ),
  );

  return rows.map((row, index) => {
    const trip = row.trip;
    let boarded = 0;
    for (const state of (rollCall.get(trip.id) ?? new Map()).values()) {
      if (state === "boarded") boarded += 1;
    }
    const stage = liveStageOf(stages.get(trip.id) ?? null, trip.endsAt, now);
    return {
      tripId: trip.id,
      title: trip.title,
      isPrivate: trip.isPrivate,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      siteName: row.siteName ?? null,
      boatName: row.boatName ?? null,
      capacity: trip.capacity,
      booked: row.booked,
      boarded,
      // Named field by field rather than spread, so `recordedByName` can never
      // ride out to the lobby the day `TripStageReading` widens.
      stage: stage
        ? { stage: stage.stage, siteName: stage.siteName, recordedAt: stage.recordedAt }
        : null,
      crewNames: input.showNames ? (crewByTrip.get(trip.id) ?? []) : [],
      meetingPointLabel: trip.meetingPointLabel,
      meetingPointAddress: trip.meetingPointAddress,
      outlook: outlookOf(forecasts[index] ?? null),
    };
  });
}
