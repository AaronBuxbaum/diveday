import { and, asc, count, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import type { AppDb, DbExecutor } from "./client";
import type { Trip } from "./schema";
import {
  bookings,
  courses,
  diveSites,
  rollCallEvents,
  tripDives,
  tripScheduleDays,
  trips,
} from "./schema";
import {
  normalizedDiveCount,
  normalizedDiveDrafts,
  primaryDiveSiteId,
  replaceTripDives,
  type TripDiveDraft,
  type TripScheduleDayInput,
  validateDiveSites,
} from "./trips-create";

/**
 * One departure's own record: read it, edit its details, its dives, its
 * conditions, its status, its meeting windows.
 *
 * Everything here is scoped by `shopId` in the query itself — staff pages must
 * never cross tenants. The edits fail closed with a typed reason rather than
 * silently discarding data: capacity can never drop below the party already on
 * the manifest, and planned dives can never drop below a dive number staff have
 * recorded a roll call against (CR-006).
 */

/** Trip scoped to a shop (staff pages must never cross tenants), with booked count. */
export async function getTripWithBooked(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ trip: trips, course: courses, diveSite: diveSites, booked: count(bookings.id) })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .groupBy(trips.id, courses.id, diveSites.id)
    .limit(1);
  const row = rows[0];
  return row
    ? { ...row.trip, course: row.course, diveSite: row.diveSite, booked: row.booked }
    : null;
}

/** One dive site's diver-facing preview facts — no shop-internal fields. */
export type TripSitePeek = {
  name: string;
  description: string | null;
  difficulty: string | null;
  depthRange: string | null;
  imageUrls: string[];
};

/**
 * Every distinct dive site a trip touches, diver-facing preview shape only —
 * the trip's own single `diveSiteId` plus any per-dive sites recorded on
 * `tripDives` for a multi-dive trip, deduped by name (primary site first).
 * Shared by every diver-facing page that shows "what you'll explore" (the
 * waiver success page and `/ready`), so the two surfaces can't drift apart
 * on what counts as the trip's site list.
 */
export async function getTripDiveSitesPeek(
  db: DbExecutor,
  tripId: string,
): Promise<TripSitePeek[]> {
  const peekColumns = {
    name: diveSites.name,
    description: diveSites.description,
    difficulty: diveSites.difficulty,
    depthRange: diveSites.depthRange,
    imageUrls: diveSites.imageUrls,
  };
  const primarySite = await db
    .select(peekColumns)
    .from(trips)
    .innerJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .where(eq(trips.id, tripId))
    .limit(1);
  const multiDiveSites = await db
    .select(peekColumns)
    .from(tripDives)
    .innerJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
    .where(eq(tripDives.tripId, tripId));

  const seenNames = new Set<string>();
  const sites: TripSitePeek[] = [];
  for (const site of [...primarySite, ...multiDiveSites]) {
    if (!seenNames.has(site.name)) {
      seenNames.add(site.name);
      sites.push(site);
    }
  }
  return sites;
}

export type TripPatch = {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  plannedDives: number;
  dives?: TripDiveDraft[];
  diveSiteId?: string | null;
  priceCents?: number | null;
  depositCents?: number | null;
  cancellationWindowHours?: number | null;
  /**
   * The trip's meeting days, replaced wholesale. Omit to leave the existing
   * rows alone; pass them whenever `startsAt`/`endsAt` move, because a day row
   * that still points at last week's dates is what the manifest, the crew
   * double-booking check, and the trip page's meeting-day list all read.
   */
  scheduleDays?: TripScheduleDayInput[];
};

export type UpdateTripOutcome =
  | { ok: true; trip: Trip }
  | { ok: false; reason: "invalid" | "not_found" }
  | { ok: false; reason: "capacity_below_booked"; detail: { bookedCount: number } }
  | { ok: false; reason: "planned_dives_below_history"; detail: { recordedDiveCount: number } };

/**
 * Edits a trip's own details/schedule/dives. Locks the trip row (mirroring
 * the booking-creation lock in `createBookingRecord`) so a concurrent
 * booking can't land between the active-booking count read and this
 * update — capacity can never end up below the party actually on the
 * manifest, and planned dives can never drop below a dive number staff have
 * already recorded a roll call against (CR-006). Both invariants fail
 * closed with a typed reason instead of silently discarding data.
 */
export async function updateTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  patch: TripPatch,
): Promise<UpdateTripOutcome> {
  return db.transaction(async (tx) => {
    const plannedDives = normalizedDiveCount(patch.plannedDives);
    if (!plannedDives) return { ok: false, reason: "invalid" };

    const [existing] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "not_found" };

    const [{ bookedCount }] = await tx
      .select({ bookedCount: count() })
      .from(bookings)
      .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
    if (patch.capacity < bookedCount) {
      return { ok: false, reason: "capacity_below_booked", detail: { bookedCount } };
    }

    const checkpointRows = await tx
      .select({
        bookingId: rollCallEvents.bookingId,
        checkpoint: rollCallEvents.checkpoint,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
        createdAt: rollCallEvents.createdAt,
      })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, tripId));
    const recordedDiveCount = maxRecordedDiveNumber(checkpointRows);
    if (plannedDives < recordedDiveCount) {
      return { ok: false, reason: "planned_dives_below_history", detail: { recordedDiveCount } };
    }

    const drafts = patch.dives ? normalizedDiveDrafts(plannedDives, patch.dives) : undefined;
    const sitesToValidate = drafts ?? (patch.diveSiteId ? [{ diveSiteId: patch.diveSiteId }] : []);
    if (!(await validateDiveSites(tx, shopId, sitesToValidate))) {
      return { ok: false, reason: "invalid" };
    }
    const [trip] = await tx
      .update(trips)
      .set({
        title: patch.title,
        description: patch.description ?? null,
        startsAt: patch.startsAt,
        endsAt: patch.endsAt,
        capacity: patch.capacity,
        priceCents: patch.priceCents ?? null,
        depositCents: patch.depositCents ?? null,
        cancellationWindowHours: patch.cancellationWindowHours ?? null,
        plannedDives,
        ...(patch.diveSiteId === undefined
          ? {}
          : { diveSiteId: patch.diveSiteId ?? (drafts ? primaryDiveSiteId(drafts) : null) }),
      })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (!trip) return { ok: false, reason: "not_found" };
    if (drafts) await replaceTripDives(tx, tripId, drafts);
    if (patch.scheduleDays) {
      await tx.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, tripId));
      await tx
        .insert(tripScheduleDays)
        .values(patch.scheduleDays.map((day, index) => ({ tripId, ...day, dayNumber: index + 1 })));
    }
    return { ok: true, trip };
  });
}

/** Ordered dive details for a trip, scoped through the owning shop. */
export async function listTripDives(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ dive: tripDives, diveSite: diveSites })
    .from(tripDives)
    .innerJoin(trips, eq(trips.id, tripDives.tripId))
    .leftJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
    .where(and(eq(tripDives.tripId, tripId), eq(trips.shopId, shopId)))
    .orderBy(asc(tripDives.diveNumber));
}

export type TripConditionsPatch = {
  conditionsHold?: boolean;
  conditionsSummary?: string;
  waterTemperatureC?: number;
  visibilityMeters?: number;
  surfaceConditions?: string;
};

/** Forecasts belong to the dated charter and are explicitly timestamped. */
export async function updateTripConditions(
  db: AppDb,
  shopId: string,
  tripId: string,
  patch: TripConditionsPatch,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ conditionsHold: trips.conditionsHold })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!before) return { trip: null, holdStarted: false };

    const [trip] = await tx
      .update(trips)
      .set({
        // Undefined means this conditions-only edit does not change the hold.
        conditionsHold: patch.conditionsHold,
        conditionsSummary: patch.conditionsSummary || null,
        waterTemperatureC: patch.waterTemperatureC ?? null,
        visibilityMeters: patch.visibilityMeters ?? null,
        surfaceConditions: patch.surfaceConditions || null,
        conditionsUpdatedAt: nowDate(),
      })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    return {
      trip: trip ?? null,
      holdStarted: patch.conditionsHold === true && !before.conditionsHold,
    };
  });
}

export async function setTripStatus(
  // Also callable inside a transaction: the blow-out cascade flips the status
  // through this same seam while holding the trip row lock (src/db/blowouts.ts).
  db: DbExecutor,
  shopId: string,
  tripId: string,
  status: "scheduled" | "cancelled",
) {
  const [trip] = await db
    .update(trips)
    .set({ status })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .returning();
  return trip ?? null;
}

export async function listTripScheduleDays(db: DbExecutor, shopId: string, tripId: string) {
  const rows = await db
    .select({ day: tripScheduleDays })
    .from(tripScheduleDays)
    .innerJoin(trips, eq(trips.id, tripScheduleDays.tripId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .orderBy(asc(tripScheduleDays.dayNumber));
  return rows.map((row) => row.day);
}
