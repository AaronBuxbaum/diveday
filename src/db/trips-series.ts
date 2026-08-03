import { and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import type { TripRecurrenceFrequency } from "@/lib/recurrence";
import type { AppDb } from "./client";
import { bookings, rollCallEvents, tripDives, tripSeries, trips } from "./schema";
import {
  insertTripInstance,
  type NewTrip,
  normalizedDiveCount,
  normalizedDiveDrafts,
  replaceTripDives,
  resolveCourse,
  validateDiveSites,
} from "./trips-create";

/**
 * Recurring series: a `trip_series` row plus one fully-formed, independent trip
 * per occurrence (ADR 20260719-recurring-trip-series).
 *
 * The whole point is that instances are independent after creation — staff edit
 * or cancel any single date without touching its siblings. The series-wide
 * operations here (`applyDetailsToFutureSeries`, `cancelFutureSeriesTrips`,
 * `extendTripSeries`) are therefore deliberate fan-outs over future
 * still-scheduled dates, never a shared row every instance reads through.
 */

export type NewTripSeries = Omit<NewTrip, "startsAt" | "endsAt"> & {
  frequency: TripRecurrenceFrequency;
  intervalWeeks: number;
  /** Pre-computed occurrences (shop-local wall time already converted to UTC). */
  occurrences: Array<{ startsAt: Date; endsAt: Date }>;
};

/**
 * Materialize a recurring series: one `trip_series` row plus one fully-formed,
 * independent trip per occurrence, all in a single transaction. Every instance
 * starts identical; staff edit or cancel any single date afterward without
 * touching its siblings (20260719-recurring-trip-series). Returns null on the
 * same validation failures as `createTrip`, or when no occurrences are supplied.
 */
export async function createTripSeries(db: AppDb, input: NewTripSeries) {
  return db.transaction(async (tx) => {
    if (input.occurrences.length === 0) return null;
    const plannedDives = normalizedDiveCount(input.plannedDives);
    if (!plannedDives) return null;
    const drafts = normalizedDiveDrafts(
      plannedDives,
      input.dives ?? (input.diveSiteId ? [{ diveSiteId: input.diveSiteId }] : undefined),
    );
    if (!(await validateDiveSites(tx, input.shopId, drafts))) return null;
    const { ok, course } = await resolveCourse(tx, input.shopId, input.courseId);
    if (!ok) return null;

    const [series] = await tx
      .insert(tripSeries)
      .values({
        shopId: input.shopId,
        title: input.title,
        frequency: input.frequency,
        intervalWeeks: input.intervalWeeks,
        occurrenceCount: input.occurrences.length,
      })
      .returning();
    if (!series) throw new Error("createTripSeries: insert returned no row");

    const created = [];
    for (const occurrence of input.occurrences) {
      created.push(
        await insertTripInstance(tx, {
          shopId: input.shopId,
          seriesId: series.id,
          courseId: input.courseId,
          course,
          title: input.title,
          description: input.description,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          capacity: input.capacity,
          plannedDives,
          priceCents: input.priceCents,
          depositCents: input.depositCents,
          cancellationWindowHours: input.cancellationWindowHours,
          drafts,
        }),
      );
    }
    return { series, trips: created };
  });
}

/**
 * The series a trip belongs to plus how many of its instances are still on the
 * schedule — provenance for the trip page's "part of a series" note. Null when
 * the trip is a one-off. `futureScheduledCount` is the subset series-wide edit,
 * cancel, and horizon-roll operate on: still-scheduled dates yet to depart.
 */
export async function getTripSeriesSummary(
  db: AppDb,
  shopId: string,
  tripId: string,
  now: Date = nowDate(),
) {
  const [row] = await db
    .select({ series: tripSeries })
    .from(trips)
    .innerJoin(tripSeries, eq(tripSeries.id, trips.seriesId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  const [counts] = await db
    .select({
      scheduled: sql<number>`count(*) filter (where ${trips.status} = 'scheduled')::int`,
      future: sql<number>`count(*) filter (where ${trips.status} = 'scheduled' and ${trips.startsAt} >= ${now})::int`,
    })
    .from(trips)
    .where(eq(trips.seriesId, row.series.id));
  return {
    ...row.series,
    scheduledCount: counts?.scheduled ?? 0,
    futureScheduledCount: counts?.future ?? 0,
  };
}

/** The series row itself, scoped to a shop — cadence for a horizon-roll. */
export async function getTripSeriesById(db: AppDb, shopId: string, seriesId: string) {
  const [row] = await db
    .select()
    .from(tripSeries)
    .where(and(eq(tripSeries.id, seriesId), eq(tripSeries.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

/** The furthest-out instance of a series — the anchor a horizon-roll extends from. */
export async function getLatestSeriesInstance(db: AppDb, shopId: string, seriesId: string) {
  const [row] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.seriesId, seriesId), eq(trips.shopId, shopId)))
    .orderBy(desc(trips.startsAt))
    .limit(1);
  return row ?? null;
}

/**
 * Cancel every still-scheduled, not-yet-departed instance of a series in one
 * action — the series-wide counterpart to `setTripStatus` on a single date.
 * Past and already-cancelled dates are left untouched (history is never
 * rewritten), and each cancelled row can still be reinstated on its own trip
 * page. Returns how many dates were taken off the board.
 */
export async function cancelFutureSeriesTrips(
  db: AppDb,
  shopId: string,
  seriesId: string,
  now: Date = nowDate(),
): Promise<number> {
  const cancelled = await db
    .update(trips)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(trips.seriesId, seriesId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, now),
      ),
    )
    .returning({ id: trips.id });
  return cancelled.length;
}

export type SeriesDetailApplyResult = { updated: number; skipped: number };

/**
 * Push one date's editable details out across the rest of a series — the
 * "edited as one, applied to the run" half of the ADR. Copies the source trip's
 * title, description, capacity, dive count, pricing, cancellation window, and
 * dive plan onto every future still-scheduled sibling; the per-instance date,
 * time, conditions, crew, roster, and status are deliberately left alone. A
 * sibling already carrying more divers than the new capacity is skipped rather
 * than stranding a booking, and the count is reported so staff can follow up.
 * Returns null when the source trip is not part of this series in this shop.
 */
export async function applyDetailsToFutureSeries(
  db: AppDb,
  shopId: string,
  seriesId: string,
  sourceTripId: string,
  now: Date = nowDate(),
): Promise<SeriesDetailApplyResult | null> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(trips)
      .where(
        and(eq(trips.id, sourceTripId), eq(trips.shopId, shopId), eq(trips.seriesId, seriesId)),
      )
      .limit(1);
    if (!source) return null;
    const sourceDives = await tx
      .select()
      .from(tripDives)
      .where(eq(tripDives.tripId, sourceTripId))
      .orderBy(asc(tripDives.diveNumber));
    const drafts = sourceDives.map((dive) => ({
      diveNumber: dive.diveNumber,
      title: dive.title,
      diveSiteId: dive.diveSiteId,
      description: dive.description,
    }));

    const siblings = await tx
      .select({ id: trips.id, booked: count(bookings.id) })
      .from(trips)
      .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
      .where(
        and(
          eq(trips.seriesId, seriesId),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          gte(trips.startsAt, now),
          ne(trips.id, sourceTripId),
        ),
      )
      .groupBy(trips.id);

    // Same operational-history invariant updateTrip enforces for a single
    // trip (CR-006) — a bulk apply must not silently orphan a sibling's
    // roll-call checkpoints either.
    const siblingIds = siblings.map((sibling) => sibling.id);
    const siblingCheckpoints =
      siblingIds.length > 0
        ? await tx
            .select({
              tripId: rollCallEvents.tripId,
              bookingId: rollCallEvents.bookingId,
              checkpoint: rollCallEvents.checkpoint,
              status: rollCallEvents.status,
              occurredAt: rollCallEvents.occurredAt,
              createdAt: rollCallEvents.createdAt,
            })
            .from(rollCallEvents)
            .where(inArray(rollCallEvents.tripId, siblingIds))
        : [];
    const checkpointsByTrip = new Map<string, typeof siblingCheckpoints>();
    for (const row of siblingCheckpoints) {
      const list = checkpointsByTrip.get(row.tripId) ?? [];
      list.push(row);
      checkpointsByTrip.set(row.tripId, list);
    }

    let updated = 0;
    let skipped = 0;
    for (const sibling of siblings) {
      if (source.capacity < sibling.booked) {
        skipped += 1;
        continue;
      }
      const recordedDiveCount = maxRecordedDiveNumber(checkpointsByTrip.get(sibling.id) ?? []);
      if (source.plannedDives < recordedDiveCount) {
        skipped += 1;
        continue;
      }
      await tx
        .update(trips)
        .set({
          title: source.title,
          description: source.description,
          capacity: source.capacity,
          plannedDives: source.plannedDives,
          priceCents: source.priceCents,
          depositCents: source.depositCents,
          cancellationWindowHours: source.cancellationWindowHours,
          diveSiteId: source.diveSiteId,
        })
        .where(and(eq(trips.id, sibling.id), eq(trips.shopId, shopId)));
      await replaceTripDives(tx, sibling.id, drafts);
      updated += 1;
    }
    return { updated, skipped };
  });
}

export type ExtendTripSeriesInput = {
  shopId: string;
  seriesId: string;
  /** Pre-computed new occurrences (shop-local wall time already converted to UTC). */
  occurrences: Array<{ startsAt: Date; endsAt: Date }>;
};

/**
 * Roll a finite series' horizon forward: materialize more independent instances
 * on the same cadence, each inheriting the furthest existing date's template
 * (details and dive plan). The occurrence window is computed by the caller from
 * that anchor via `weeklyOccurrencesAfter`, so no date already on the board is
 * ever duplicated. Bumps `occurrenceCount` to the new materialized total. Returns
 * null when the series is unknown to the shop, has no instance to template from,
 * its course was archived, or no occurrences were supplied.
 */
export async function extendTripSeries(db: AppDb, input: ExtendTripSeriesInput) {
  return db.transaction(async (tx) => {
    if (input.occurrences.length === 0) return null;
    const [series] = await tx
      .select()
      .from(tripSeries)
      .where(and(eq(tripSeries.id, input.seriesId), eq(tripSeries.shopId, input.shopId)))
      .limit(1);
    if (!series) return null;
    const [template] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.seriesId, input.seriesId), eq(trips.shopId, input.shopId)))
      .orderBy(desc(trips.startsAt))
      .limit(1);
    if (!template) return null;
    // Fail closed on a course session whose course was archived after the series
    // was built: guessing the cert gate on a safety surface is never acceptable.
    const { ok, course } = await resolveCourse(tx, input.shopId, template.courseId ?? undefined);
    if (!ok) return null;
    const templateDives = await tx
      .select()
      .from(tripDives)
      .where(eq(tripDives.tripId, template.id))
      .orderBy(asc(tripDives.diveNumber));
    const drafts = templateDives.map((dive) => ({
      diveNumber: dive.diveNumber,
      title: dive.title,
      diveSiteId: dive.diveSiteId,
      description: dive.description,
    }));

    const created = [];
    for (const occurrence of input.occurrences) {
      created.push(
        await insertTripInstance(tx, {
          shopId: input.shopId,
          seriesId: series.id,
          courseId: template.courseId ?? undefined,
          course,
          title: template.title,
          description: template.description ?? undefined,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          capacity: template.capacity,
          plannedDives: template.plannedDives,
          priceCents: template.priceCents,
          depositCents: template.depositCents,
          cancellationWindowHours: template.cancellationWindowHours,
          drafts,
        }),
      );
    }
    const [updatedSeries] = await tx
      .update(tripSeries)
      .set({ occurrenceCount: series.occurrenceCount + created.length })
      .where(eq(tripSeries.id, series.id))
      .returning();
    return { series: updatedSeries ?? series, trips: created };
  });
}
