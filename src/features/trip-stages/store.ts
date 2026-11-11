import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { liveTrip } from "@/db/trips";
import { listRollCallGaps } from "@/features/roll-call-gaps";
import { loadActiveStaffRoles } from "../../db/authz";
import type { AppDb, DbExecutor } from "../../db/client";
import { getTripManifests, listUnaccountedForByTrip } from "../../db/manifests";
import { diveSites, people, tripDives, tripStageEvents, trips } from "../../db/schema/index";
import { isStaff } from "../../lib/authz";
import {
  type CheckpointGap,
  homewardCheckpointGap,
  isHomewardStage,
} from "../../lib/checkpoint-gaps";
import { nowDate } from "../../lib/clock";
import { departureStage } from "../../lib/trip-phase";
import type { TripStage, TripStageReading } from "../../lib/trip-stages";

/**
 * **The stage ledger's one writer and its three readers** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * A stage is a thing a crew member said. Nothing here infers one, nothing
 * edits one, and nothing deletes one: the newest row wins, and a crew that
 * taps the wrong word taps the right one.
 */

export type RecordTripStageOutcome =
  | {
      ok: true;
      eventId: string;
      /**
       * "Heading in" or "Home" said while the last after-dive roll call still
       * has somebody unmarked (batch 6, item 4): the checkpoint and how many.
       * The word is recorded all the same; this is the warning, reported by
       * the server so it never rests on the screen alone. Null for any other
       * word, and once the count has everyone.
       */
      rollCallOpen: CheckpointGap | null;
    }
  | { ok: false; reason: "staff_not_found" | "trip_unavailable" };

/**
 * Records one tap.
 *
 * The refusals are the same two `recordPreDepartureCheck` makes on the same
 * surface, and both are proved rather than assumed: the person must still hold
 * an active staff role at this shop, and the departure must be this shop's and
 * not deleted. A stage is written to a *safety* surface, so a caller that gets
 * either wrong is refused rather than quietly writing a row nobody meant.
 */
export async function recordTripStage(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    stage: TripStage;
    recordedByPersonId: string;
    recordedAt?: Date;
  },
): Promise<RecordTripStageOutcome> {
  // **Home said with the count open** (issue #3896): read before the word,
  // so the event keeps how many the record names as not counted after a dive
  // (`notCountedAtHome`), crew included and anyone recorded not back aboard
  // left to their own band (dock review S1). Home is never refused: the
  // crew's word is final. A read that fails records the word without a count
  // rather than making the crew tap again.
  const recordedAt = input.recordedAt ?? nowDate();
  const manifestsBefore =
    input.stage === "home"
      ? await getTripManifests(db, input.shopId, input.tripId).catch(() => null)
      : null;
  const countedNow =
    input.stage === "home"
      ? await notCountedAtHome(db, input.shopId, input.tripId, recordedAt).catch(() => null)
      : null;
  const recorded = await db.transaction(async (tx) => {
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.recordedByPersonId);
    if (!roles || !isStaff(roles)) return { ok: false, reason: "staff_not_found" } as const;

    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return { ok: false, reason: "trip_unavailable" } as const;

    // The site is snapshotted from the plan as it stands at the tap, never
    // resolved at render: a later edit to the dive plan must not rewrite a
    // sentence a diver has already read. The first dive's site is the one the
    // boat is going to; a departure with no plan has none, and the siteless
    // word is a real answer.
    const [firstDive] = await tx
      .select({ diveSiteId: tripDives.diveSiteId })
      .from(tripDives)
      .where(eq(tripDives.tripId, input.tripId))
      .orderBy(asc(tripDives.diveNumber))
      .limit(1);

    // **A second Home never erases the first's count** (attacker review S3):
    // the line is evidence of the count Home was said over, so the largest
    // one any earlier Home on this departure stored is carried forward.
    const [earlier] =
      input.stage === "home"
        ? await tx
            .select({ most: max(tripStageEvents.notCounted) })
            .from(tripStageEvents)
            .where(
              and(
                eq(tripStageEvents.shopId, input.shopId),
                eq(tripStageEvents.tripId, input.tripId),
                eq(tripStageEvents.stage, "home"),
              ),
            )
        : [];
    const notCounted = Math.max(countedNow ?? 0, earlier?.most ?? 0) || null;

    const [event] = await tx
      .insert(tripStageEvents)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        stage: input.stage,
        diveSiteId: firstDive?.diveSiteId ?? null,
        recordedByPersonId: input.recordedByPersonId,
        recordedAt,
        notCounted,
      })
      .returning({ id: tripStageEvents.id });
    if (!event) return { ok: false, reason: "trip_unavailable" } as const;
    return { ok: true, eventId: event.id } as const;
  });
  if (!recorded.ok) return recorded;
  // Read after the word commits, from the manifest itself — the same count the
  // roll call the crew would open closes on (`homewardCheckpointGap`).
  // A read that fails here must not turn a recorded word into an error the
  // crew answers by tapping again: the manifest re-renders with the same
  // warning from its own read (`stageStripProps`).
  const rollCallOpen = manifestsBefore
    ? homewardCheckpointGap(manifestsBefore)
    : isHomewardStage(input.stage)
      ? await getTripManifests(db, input.shopId, input.tripId)
          .then((manifests) => homewardCheckpointGap(manifests ?? []))
          .catch(() => null)
      : null;
  return { ...recorded, rollCallOpen };
}

const READING_COLUMNS = {
  tripId: tripStageEvents.tripId,
  stage: tripStageEvents.stage,
  siteName: diveSites.name,
  recordedAt: tripStageEvents.recordedAt,
  recordedByName: people.fullName,
  notCounted: tripStageEvents.notCounted,
  seq: tripStageEvents.seq,
};

/** The newest tap on one departure, whatever its age. */
export async function latestTripStage(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<TripStageReading | null> {
  const [row] = await db
    .select(READING_COLUMNS)
    .from(tripStageEvents)
    // Both lookups are shop-scoped in their own right, not merely by way of
    // the event row. The site name this resolves is printed to an anonymous
    // visitor on the storefront, and `tripDiveSiteSummaries` beside it already
    // joins this way. Relying on `validateDiveSites` two modules away is the
    // shape that put another shop's vessel name on the board once already
    // (`trips.boat_id`, src/db/trips-create.ts) — so the crew name gets the
    // same predicate rather than an argument about which writer could ever
    // mis-tenant `recorded_by_person_id`.
    .leftJoin(
      diveSites,
      and(eq(tripStageEvents.diveSiteId, diveSites.id), eq(diveSites.shopId, shopId)),
    )
    .leftJoin(
      people,
      and(eq(tripStageEvents.recordedByPersonId, people.id), eq(people.shopId, shopId)),
    )
    .where(and(eq(tripStageEvents.shopId, shopId), eq(tripStageEvents.tripId, tripId)))
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq))
    .limit(1);
  return row
    ? {
        stage: row.stage,
        siteName: row.siteName ?? null,
        recordedAt: row.recordedAt,
        recordedByName: row.recordedByName,
        notCounted: row.notCounted,
      }
    : null;
}

/**
 * The newest tap on each of several departures, in one pass — the shape the
 * shop home needs, where asking per station would be one query per boat.
 */
export async function latestTripStagesByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, TripStageReading>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select(READING_COLUMNS)
    .from(tripStageEvents)
    // Both lookups are shop-scoped in their own right, not merely by way of
    // the event row. The site name this resolves is printed to an anonymous
    // visitor on the storefront, and `tripDiveSiteSummaries` beside it already
    // joins this way. Relying on `validateDiveSites` two modules away is the
    // shape that put another shop's vessel name on the board once already
    // (`trips.boat_id`, src/db/trips-create.ts) — so the crew name gets the
    // same predicate rather than an argument about which writer could ever
    // mis-tenant `recorded_by_person_id`.
    .leftJoin(
      diveSites,
      and(eq(tripStageEvents.diveSiteId, diveSites.id), eq(diveSites.shopId, shopId)),
    )
    .leftJoin(
      people,
      and(eq(tripStageEvents.recordedByPersonId, people.id), eq(people.shopId, shopId)),
    )
    .where(and(eq(tripStageEvents.shopId, shopId), inArray(tripStageEvents.tripId, [...tripIds])))
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq));
  const newest = new Map<string, TripStageReading>();
  // Ordered newest first, so the first row seen for a trip is its answer.
  for (const row of rows) {
    if (newest.has(row.tripId)) continue;
    newest.set(row.tripId, {
      stage: row.stage,
      siteName: row.siteName ?? null,
      recordedAt: row.recordedAt,
      recordedByName: row.recordedByName,
      notCounted: row.notCounted,
    });
  }
  return newest;
}

function holdsTheBoat(gap: {
  reason: string;
  diveNumber: number;
  awaiting: number;
  total: number;
}) {
  if (gap.diveNumber < 1) return false;
  if (gap.reason === "missing_diver" || gap.reason === "missing_crew") return true;
  return gap.awaiting < gap.total;
}

/**
 * Read departure timing and crew stage with shop-scoped roll-call data; the
 * clock alone cannot mark a departure home while someone may be in the water.
 *
 * Two answers keep it open (loop 5, row 4; issue #2404): a seat recorded not
 * back aboard and not counted since (`listUnaccountedForByTrip`), and **an
 * after-dive count still open**: somebody who went out with no word at an
 * after-dive checkpoint, diver or crew (`listRollCallGaps`, historical mode,
 * the one detector Today and the close-out read). A night boat out past
 * midnight with a diver unmarked used to read as finished by the clock. The
 * crew's own Home still finishes it (`departureStage`): that is the
 * departure's last word. The record names a seat recorded not back aboard,
 * and, apart from Sailed, a seat no started after-dive count included
 * (`notCountedAfterDive`, #3895); Today keeps chasing that count.
 * The gap read runs only once the departure would otherwise read finished, so
 * a boat still out costs nothing more.
 */
export async function readDepartureStage(
  db: AppDb,
  shopId: string,
  tripId: string,
  reading: Omit<Parameters<typeof departureStage<TripStageReading>>[0], "unaccountedFor">,
) {
  const unaccounted =
    (await listUnaccountedForByTrip(db, shopId, [tripId])).get(tripId) ?? new Set<string>();
  let stage = departureStage({ ...reading, unaccountedFor: unaccounted.size > 0 });
  let notCounted: NotCountedAfterDive = { seats: new Map(), crew: [] };
  if (stage.finished) {
    const gaps = await listRollCallGaps(db, shopId, reading.now, [tripId], { historical: true });
    // An after-dive checkpoint only, and only one someone started or a person
    // recorded not back: a dock count left open, a shop that never counts after
    // a dive, or no roll call at all is paperwork and never holds a boat.
    if (unaccounted.size === 0 && gaps.some(holdsTheBoat)) {
      stage = departureStage({ ...reading, unaccountedFor: true });
    }
    // Finished all the same (the crew's Home): the seats and crew no started
    // after-dive count included, for the record to name apart from Sailed
    // (#3895).
    if (stage.finished) notCounted = await namedNotCounted(db, shopId, gaps, unaccounted);
  }
  return {
    ...stage,
    unaccounted: unaccounted as ReadonlySet<string>,
    notCountedAfterDive: notCounted.seats,
    crewNotCountedAfterDive: notCounted.crew,
  };
}

type NotCountedAfterDive = {
  /** Booking id to the first started after-dive count that left the seat out. */
  seats: ReadonlyMap<string, number>;
  /** Crew left out of a started after-dive count, by name, first such dive. */
  crew: readonly { personId: string; name: string; dive: number }[];
};

/**
 * Who no started after-dive count included, apart from anyone recorded not
 * back aboard (`unaccounted`, named as missing). The first dive each was left
 * out of wins, across meeting days too.
 */
async function namedNotCounted(
  db: DbExecutor,
  shopId: string,
  gaps: Awaited<ReturnType<typeof listRollCallGaps>>,
  unaccounted: ReadonlySet<string>,
): Promise<NotCountedAfterDive> {
  const seats = new Map<string, number>();
  const crew = new Map<string, number>();
  for (const gap of gaps) {
    const crewRow = gap.reason === "missing_crew" || gap.reason === "crew_uncounted";
    const into = crewRow ? crew : seats;
    for (const [id, dive] of gap.notCountedAfterDive ?? []) {
      if (!crewRow && unaccounted.has(id)) continue;
      const known = into.get(id);
      if (known === undefined || dive < known) into.set(id, dive);
    }
  }
  const names =
    crew.size === 0
      ? []
      : await db
          .select({ id: people.id, name: people.fullName })
          .from(people)
          // diveday:allow-deleted-people: a record of who was aboard names the
          // crew member who was, by an id the roll call already proved.
          .where(and(eq(people.shopId, shopId), inArray(people.id, [...crew.keys()])));
  return {
    seats,
    crew: names
      .map((row) => ({ personId: row.id, name: row.name, dive: crew.get(row.id) ?? 0 }))
      .sort((a, b) => a.dive - b.dive || a.name.localeCompare(b.name)),
  };
}

/**
 * **How many Home leaves uncounted** (issues #3895, #3896): the seats and
 * crew the departure record will name under "Not counted after dive N", read
 * by the same rule at the moment of the tap, so the stored number and the
 * names under it agree when Home is said. A dive nobody started counting
 * (one called off with the plan left at the old count) names nobody and adds
 * nothing; a person recorded not back aboard is missing, not uncounted.
 */
async function notCountedAtHome(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date,
): Promise<number> {
  const unaccounted =
    (await listUnaccountedForByTrip(db, shopId, [tripId])).get(tripId) ?? new Set<string>();
  const gaps = await listRollCallGaps(db, shopId, now, [tripId], { historical: true });
  const named = await namedNotCounted(db, shopId, gaps, unaccounted);
  return named.seats.size + named.crew.length;
}
