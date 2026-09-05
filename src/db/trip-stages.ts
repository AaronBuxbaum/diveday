import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { liveStageOf, type TripStage, type TripStageReading } from "@/lib/trip-stages";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { diveSites, people, tripDives, tripStageEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The stage ledger's one writer and its three readers** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * A stage is a thing a crew member said. Nothing here infers one, nothing
 * edits one, and nothing deletes one: the newest row wins, and a crew that
 * taps the wrong word taps the right one.
 */

export type RecordTripStageOutcome =
  | { ok: true; eventId: string }
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
  return db.transaction(async (tx): Promise<RecordTripStageOutcome> => {
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.recordedByPersonId);
    if (!roles || !isStaff(roles)) return { ok: false, reason: "staff_not_found" };

    const [trip] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return { ok: false, reason: "trip_unavailable" };

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

    const [event] = await tx
      .insert(tripStageEvents)
      .values({
        shopId: input.shopId,
        tripId: input.tripId,
        stage: input.stage,
        diveSiteId: firstDive?.diveSiteId ?? null,
        recordedByPersonId: input.recordedByPersonId,
        recordedAt: input.recordedAt ?? nowDate(),
      })
      .returning({ id: tripStageEvents.id });
    if (!event) return { ok: false, reason: "trip_unavailable" };
    return { ok: true, eventId: event.id };
  });
}

const READING_COLUMNS = {
  tripId: tripStageEvents.tripId,
  stage: tripStageEvents.stage,
  siteName: diveSites.name,
  recordedAt: tripStageEvents.recordedAt,
  recordedByName: people.fullName,
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
    .leftJoin(diveSites, eq(tripStageEvents.diveSiteId, diveSites.id))
    .leftJoin(people, eq(tripStageEvents.recordedByPersonId, people.id))
    .where(and(eq(tripStageEvents.shopId, shopId), eq(tripStageEvents.tripId, tripId)))
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq))
    .limit(1);
  return row
    ? { ...row, siteName: row.siteName ?? null, recordedByName: row.recordedByName }
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
    .leftJoin(diveSites, eq(tripStageEvents.diveSiteId, diveSites.id))
    .leftJoin(people, eq(tripStageEvents.recordedByPersonId, people.id))
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
    });
  }
  return newest;
}

export type LiveShopStage = TripStageReading & {
  tripId: string;
  tripTitle: string;
  boatName: string | null;
  endsAt: Date | null;
};

/**
 * **The one departure the shop's own website may say is out.**
 *
 * Narrowed at the query rather than at the surface, because this is the only
 * place in the app where an operational fact reaches an anonymous visitor: a
 * private charter is never named, a cancelled or deleted departure is never
 * named, and `home` is never published (`stageIsPublishable`). What is left is
 * a boat that a crew said is out, on a day the shop is open to the public.
 */
export async function liveShopStage(
  db: DbExecutor,
  shopId: string,
  now: Date,
  windowStart: Date,
): Promise<LiveShopStage | null> {
  const rows = await db
    .select({
      ...READING_COLUMNS,
      tripTitle: trips.title,
      endsAt: trips.endsAt,
    })
    .from(tripStageEvents)
    .innerJoin(trips, eq(tripStageEvents.tripId, trips.id))
    .leftJoin(diveSites, eq(tripStageEvents.diveSiteId, diveSites.id))
    .leftJoin(people, eq(tripStageEvents.recordedByPersonId, people.id))
    .where(
      and(
        eq(tripStageEvents.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gte(tripStageEvents.recordedAt, windowStart),
        lt(tripStageEvents.recordedAt, now),
      ),
    )
    .orderBy(desc(tripStageEvents.recordedAt), desc(tripStageEvents.seq));

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.tripId)) continue;
    seen.add(row.tripId);
    const reading = liveStageOf(
      {
        stage: row.stage,
        siteName: row.siteName ?? null,
        recordedAt: row.recordedAt,
        recordedByName: row.recordedByName,
      },
      row.endsAt,
      now,
    );
    if (!reading || reading.stage === "home") continue;
    return {
      ...reading,
      tripId: row.tripId,
      tripTitle: row.tripTitle,
      boatName: null,
      endsAt: row.endsAt,
    };
  }
  return null;
}
