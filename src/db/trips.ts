import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { reviewManifestChange } from "@/lib/manifest-change-review";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import type { TripRecurrenceFrequency } from "@/lib/recurrence";
import { shiftInstantByWallTimeDelta, utcToWallTime, wallTimeDeltaMs } from "@/lib/zoned";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import { decodeCursor, encodeCursor } from "./cursor";
import type { Course, Trip } from "./schema";
import {
  bookings,
  courses,
  diveSites,
  people,
  personRoles,
  rollCallEvents,
  shops,
  tripAssignments,
  tripDives,
  tripLastMinutePromos,
  tripRequirements,
  tripScheduleDays,
  tripSeries,
  trips,
  tripWaitlistEntries,
} from "./schema";

/**
 * Wall-clock delta between an existing start and a new one, computed in the
 * shop's own timezone rather than as a raw millisecond difference — the
 * DST-safe way to move a multi-day trip. `moveTrip`/`duplicateTrip` use this
 * so `endsAt` and every schedule day shift by the same *wall-clock* delta as
 * the start: a whole-day shift alone (the common multi-day-course case)
 * keeps each day's own published hour intact even when the span crosses a
 * DST transition, and a shift that also changes the start's clock time (the
 * common single-day case, e.g. "move to Thursday at 7am instead of 9am")
 * carries that same time change through to `endsAt` so the trip's duration
 * is preserved instead of leaving `endsAt` stuck at its old wall-clock hour
 * (see docs/product/archive/specialist-optimization-audit-20260731.md
 * §7).
 */
function tripShiftPlan(existingStartsAt: Date, newStartsAt: Date, timeZone: string) {
  const deltaMs = wallTimeDeltaMs(
    utcToWallTime(existingStartsAt, timeZone),
    utcToWallTime(newStartsAt, timeZone),
  );
  return (date: Date) => shiftInstantByWallTimeDelta(date, deltaMs, timeZone);
}

export type NewTrip = {
  shopId: string;
  courseId?: string;
  diveSiteId?: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  plannedDives?: number;
  dives?: TripDiveDraft[];
  priceCents?: number | null;
  depositCents?: number | null;
  cancellationWindowHours?: number | null;
  scheduleDays?: TripScheduleDayInput[];
};

export type TripScheduleDayInput = {
  dayNumber: number;
  startsAt: Date;
  endsAt: Date;
};

export type TripDiveDraft = {
  title?: string | null;
  diveSiteId?: string | null;
  description?: string | null;
};

const MAX_TRIP_DIVES = 4;

function normalizedDiveCount(plannedDives?: number) {
  const count = plannedDives ?? 2;
  return Number.isInteger(count) && count >= 1 && count <= MAX_TRIP_DIVES ? count : null;
}

function normalizedDiveDrafts(plannedDives: number, drafts: TripDiveDraft[] | undefined) {
  return Array.from({ length: plannedDives }, (_, index) => {
    const draft = drafts?.[index];
    return {
      diveNumber: index + 1,
      title: draft?.title?.trim() || null,
      diveSiteId: draft?.diveSiteId || null,
      description: draft?.description?.trim() || null,
    };
  });
}

async function validateDiveSites(
  db: DbExecutor,
  shopId: string,
  drafts: Array<{ diveSiteId: string | null }>,
) {
  const siteIds = drafts.map((draft) => draft.diveSiteId).filter((id): id is string => Boolean(id));
  if (siteIds.length === 0) return true;
  const sites = await db
    .select({ id: diveSites.id })
    .from(diveSites)
    .where(
      and(
        eq(diveSites.shopId, shopId),
        inArray(diveSites.id, siteIds),
        isNull(diveSites.deletedAt),
      ),
    );
  return sites.length === new Set(siteIds).size;
}

async function replaceTripDives(
  db: DbExecutor,
  tripId: string,
  drafts: ReturnType<typeof normalizedDiveDrafts>,
) {
  await db.delete(tripDives).where(eq(tripDives.tripId, tripId));
  await db.insert(tripDives).values(drafts.map((draft) => ({ tripId, ...draft })));
}

/** Resolve and validate an optional course reference inside a transaction. */
async function resolveCourse(
  tx: AppTransaction,
  shopId: string,
  courseId: string | undefined,
): Promise<{ ok: boolean; course: Course | null }> {
  if (!courseId) return { ok: true, course: null };
  const course = (
    await tx
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId), eq(courses.isActive, true)))
      .limit(1)
  )[0];
  return course ? { ok: true, course } : { ok: false, course: null };
}

/**
 * Insert one trip plus its dives and readiness requirements. The single source
 * of truth for materializing a trip so a one-off and every instance of a series
 * share identical dive and requirement wiring — a missing requirement row is a
 * readiness blocker, never an accidental pass, and a course session snapshots
 * its catalog baseline against later catalog edits.
 */
async function insertTripInstance(
  tx: AppTransaction,
  params: {
    shopId: string;
    seriesId?: string;
    courseId?: string;
    course: Course | null;
    title: string;
    description?: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    plannedDives: number;
    priceCents?: number | null;
    depositCents?: number | null;
    cancellationWindowHours?: number | null;
    drafts: ReturnType<typeof normalizedDiveDrafts>;
    scheduleDays?: TripScheduleDayInput[];
  },
) {
  const [trip] = await tx
    .insert(trips)
    .values({
      shopId: params.shopId,
      seriesId: params.seriesId,
      courseId: params.courseId,
      title: params.title,
      description: params.description,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      capacity: params.capacity,
      priceCents: params.priceCents,
      depositCents: params.depositCents,
      cancellationWindowHours: params.cancellationWindowHours,
      plannedDives: params.plannedDives,
      diveSiteId: params.drafts[0]?.diveSiteId ?? null,
    })
    .returning();
  if (!trip) throw new Error("insertTripInstance: insert returned no row");
  await tx.insert(tripDives).values(params.drafts.map((draft) => ({ tripId: trip.id, ...draft })));
  await tx
    .insert(tripScheduleDays)
    .values(
      (params.scheduleDays?.length
        ? params.scheduleDays
        : [{ dayNumber: 1, startsAt: params.startsAt, endsAt: params.endsAt }]
      ).map((day, index) => ({ tripId: trip.id, ...day, dayNumber: index + 1 })),
    );
  await tx.insert(tripRequirements).values({
    tripId: trip.id,
    shopId: params.shopId,
    // Every trip starts waiver-gated; staff can lift it per trip, but nothing
    // in the catalog schedules an unsigned session by default.
    requiresWaiver: true,
    // A course session inherits its catalog baseline verbatim, including a
    // deliberate null: uncertified students are the whole point of Discover
    // Scuba and Open Water. `??` cannot tell "no course" from "a course open to
    // uncertified divers", and collapsing the two put an Open Water gate on
    // every entry-level class — which staff then clear by blanking the trip's
    // requirements, taking the waiver gate down with it.
    minimumCertificationLevel: params.course
      ? params.course.minimumCertificationLevel
      : "open_water",
  });
  return trip;
}

export async function createTrip(db: AppDb, input: NewTrip) {
  return db.transaction(async (tx) => {
    const plannedDives = normalizedDiveCount(input.plannedDives);
    if (!plannedDives) return null;
    const drafts = normalizedDiveDrafts(
      plannedDives,
      input.dives ?? (input.diveSiteId ? [{ diveSiteId: input.diveSiteId }] : undefined),
    );
    if (!(await validateDiveSites(tx, input.shopId, drafts))) return null;
    const { ok, course } = await resolveCourse(tx, input.shopId, input.courseId);
    if (!ok) return null;
    return insertTripInstance(tx, {
      shopId: input.shopId,
      courseId: input.courseId,
      course,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      plannedDives,
      priceCents: input.priceCents,
      depositCents: input.depositCents,
      cancellationWindowHours: input.cancellationWindowHours,
      drafts,
      scheduleDays: input.scheduleDays,
    });
  });
}

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
          : { diveSiteId: patch.diveSiteId ?? drafts?.[0]?.diveSiteId ?? null }),
      })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (!trip) return { ok: false, reason: "not_found" };
    if (drafts) await replaceTripDives(tx, tripId, drafts);
    return { ok: true, trip };
  });
}

export type MoveTripOutcome =
  | { ok: true; trip: Trip }
  | { ok: false; reason: "not_found" | "not_scheduled" | "already_sailed" | "invalid" };

/**
 * Slides a whole departure to a new instant, keeping its shape.
 *
 * The caller sets a new *start*; the end and every schedule day shift by
 * that same wall-clock delta in the shop's own timezone, so a two-tank
 * morning stays three and a half hours long even when the move also changes
 * the start's clock time, and a three-day course stays three days with its
 * second and third mornings at their own published wall-clock hour even
 * when the move crosses a DST transition (a fixed millisecond shift would
 * drift day 2/3 by the DST offset change; see `tripShiftPlan`). Editing the
 * individual windows is still the trip page's job — this is the schedule
 * builder's "drag it to Thursday", nothing more.
 *
 * Refuses a trip that has any roll-call history: the crew has begun counting
 * heads against that departure, and moving the date under a manifest already in
 * progress is not a schedule edit, it is a falsified record. Refuses a cancelled
 * trip for the same reason a cancelled trip is not on the board.
 */
export async function moveTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  startsAt: Date,
): Promise<MoveTripOutcome> {
  if (Number.isNaN(startsAt.getTime())) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "not_found" };
    if (existing.status !== "scheduled") return { ok: false, reason: "not_scheduled" };

    const [{ events }] = await tx
      .select({ events: count() })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, tripId));
    if (events > 0) return { ok: false, reason: "already_sailed" };

    if (startsAt.getTime() === existing.startsAt.getTime()) return { ok: true, trip: existing };

    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return { ok: false, reason: "not_found" };
    const shift = tripShiftPlan(existing.startsAt, startsAt, shop.timezone);

    const [trip] = await tx
      .update(trips)
      .set({ startsAt, endsAt: shift(existing.endsAt) })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .returning();
    if (!trip) return { ok: false, reason: "not_found" };

    const days = await tx
      .select()
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, tripId));
    for (const day of days) {
      await tx
        .update(tripScheduleDays)
        .set({ startsAt: shift(day.startsAt), endsAt: shift(day.endsAt) })
        .where(eq(tripScheduleDays.id, day.id));
    }
    return { ok: true, trip };
  });
}

export type DeleteTripOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "has_roster" | "already_sailed" };

/**
 * Takes a departure off the board for good — the schedule builder's "remove".
 *
 * Deliberately *not* how a trip with divers on it goes away. A trip anyone has
 * booked, joined a wait list for, or counted heads against gets cancelled
 * (`setTripStatus`), which keeps the roster, the refund story, and the record
 * that the day existed. Hard deletion is reserved for a departure that was put
 * on the board by mistake and that nobody has touched — there, leaving a
 * cancelled ghost behind is clutter, not history.
 *
 * The guard is checked under a row lock, so a booking landing mid-delete loses
 * the race rather than being silently erased with its trip.
 */
export async function deleteTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<DeleteTripOutcome> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!existing) return { ok: false, reason: "not_found" };

    // Any booking at all, cancelled ones included: a cancelled booking is a
    // diver who was once on this manifest, and that is history to keep.
    const [{ roster }] = await tx
      .select({ roster: count() })
      .from(bookings)
      .where(eq(bookings.tripId, tripId));
    if (roster > 0) return { ok: false, reason: "has_roster" };

    const [{ waiting }] = await tx
      .select({ waiting: count() })
      .from(tripWaitlistEntries)
      .where(eq(tripWaitlistEntries.tripId, tripId));
    if (waiting > 0) return { ok: false, reason: "has_roster" };

    const [{ events }] = await tx
      .select({ events: count() })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, tripId));
    if (events > 0) return { ok: false, reason: "already_sailed" };

    // Children without a cascade of their own, innermost first. `activityEvents`
    // cascades from the trip and needs no line here.
    await tx.delete(tripLastMinutePromos).where(eq(tripLastMinutePromos.tripId, tripId));
    await tx.delete(tripAssignments).where(eq(tripAssignments.tripId, tripId));
    await tx.delete(tripRequirements).where(eq(tripRequirements.tripId, tripId));
    await tx.delete(tripDives).where(eq(tripDives.tripId, tripId));
    await tx.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, tripId));
    await tx.delete(trips).where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));
    return { ok: true };
  });
}

/**
 * Puts a copy of an existing departure on the board at a new instant — "same
 * trip, next Thursday", the move a shop makes twenty times a season.
 *
 * Copies what defines the dive: title, description, course, capacity, planned
 * dives and their sites, prices, and the cancellation window, with every
 * schedule day shifted by the same wall-clock delta as the start (in the
 * shop's own timezone, DST-safe — see `tripShiftPlan`) so a multi-day course
 * keeps its shape and its published wall-clock hours. Copies nothing about
 * the *day*: no roster, no wait list, no crew, no conditions, no series
 * membership. A duplicate is a fresh departure that looks like the old one,
 * never a second view of it.
 */
export async function duplicateTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  startsAt: Date,
): Promise<Trip | null> {
  if (Number.isNaN(startsAt.getTime())) return null;
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1);
    if (!source) return null;

    const [shop] = await tx
      .select({ timezone: shops.timezone })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    if (!shop) return null;
    const shift = tripShiftPlan(source.startsAt, startsAt, shop.timezone);
    const [dives, days] = await Promise.all([
      tx
        .select()
        .from(tripDives)
        .where(eq(tripDives.tripId, tripId))
        .orderBy(asc(tripDives.diveNumber)),
      tx
        .select()
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, tripId))
        .orderBy(asc(tripScheduleDays.dayNumber)),
    ]);
    const { ok, course } = await resolveCourse(tx, shopId, source.courseId ?? undefined);
    if (!ok) return null;

    return insertTripInstance(tx, {
      shopId,
      courseId: source.courseId ?? undefined,
      course,
      title: source.title,
      description: source.description ?? undefined,
      startsAt,
      endsAt: shift(source.endsAt),
      capacity: source.capacity,
      plannedDives: source.plannedDives,
      priceCents: source.priceCents,
      depositCents: source.depositCents,
      cancellationWindowHours: source.cancellationWindowHours,
      drafts: dives.map((dive) => ({
        diveNumber: dive.diveNumber,
        title: dive.title,
        diveSiteId: dive.diveSiteId,
        description: dive.description,
      })),
      scheduleDays: days.map((day) => ({
        dayNumber: day.dayNumber,
        startsAt: shift(day.startsAt),
        endsAt: shift(day.endsAt),
      })),
    });
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

/** Email recipients holding active seats on one tenant-scoped trip. */
export async function listTripDiverContacts(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ fullName: people.fullName, email: people.email })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
        isNull(people.deletedAt),
      ),
    );
}

export async function setTripStatus(
  db: AppDb,
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

/** All people holding at least one staff role in the shop, with their roles. */
export async function listStaff(db: AppDb, shopId: string) {
  const rows = await db
    .select({ person: people, role: personRoles.role })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .orderBy(asc(people.fullName));
  const byId = new Map<string, { person: typeof people.$inferSelect; roles: string[] }>();
  for (const { person, role } of rows) {
    const entry = byId.get(person.id) ?? { person, roles: [] };
    entry.roles.push(role);
    byId.set(person.id, entry);
  }
  return [...byId.values()];
}

/**
 * `trip_assignments` has no `shop_id` of its own (CR-007) — every read here
 * proves membership by joining through the trip that owns it, the same
 * pattern `setTripCrew` uses for its write, rather than trusting a bare
 * trip UUID the caller might supply for any shop.
 */
export async function getTripCrewIds(db: AppDb, shopId: string, tripId: string): Promise<string[]> {
  const rows = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(and(eq(tripAssignments.tripId, tripId), eq(trips.shopId, shopId)));
  return rows.map((r) => r.personId);
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

/**
 * Replace a trip's crew. Only people with a staff role in the shop stick.
 * Proves the trip itself belongs to the shop in the same transaction as the
 * write — `trip_assignments` carries no `shop_id` of its own to lean on, so
 * without this a tripId for any shop plus a validated personId list would
 * silently rewrite another shop's crew (CR-007). Returns false, doing
 * nothing, for a tripId that isn't this shop's.
 */
export async function setTripCrew(
  db: AppDb,
  shopId: string,
  tripId: string,
  personIds: string[],
): Promise<boolean> {
  const staff = await listStaff(db, shopId);
  const valid = personIds.filter((id) => staff.some((s) => s.person.id === id));
  return db.transaction(async (tx) => {
    const [trip] = await tx
      .select({
        id: trips.id,
        startsAt: trips.startsAt,
        endsAt: trips.endsAt,
        courseId: trips.courseId,
      })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!trip) return false;
    if (trip.courseId) {
      const [course] = await tx
        .select()
        .from(courses)
        .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, shopId)))
        .limit(1);
      const [{ bookedCount }] = await tx
        .select({ bookedCount: count() })
        .from(bookings)
        .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
      const assigned = staff.filter((member) => valid.includes(member.person.id));
      const review = reviewManifestChange({
        courseRequiresInstructor: true,
        proposedCrew: assigned,
      });
      if (review.blocking) return false;
      const instructors = assigned.filter((member) => member.roles.includes("instructor")).length;
      if (instructors === 0) return false;
      const assistants = assigned.filter(
        (member) => member.roles.includes("divemaster") && !member.roles.includes("instructor"),
      ).length;
      // One definition of "which ratio does this session carry" (src/lib/course-ratios.ts)
      // — null means it carries none.
      const seatCap = courseSeatCapacity(course ?? null, instructors, assistants);
      if (seatCap !== null && bookedCount > seatCap) return false;
    }
    const days = await tx
      .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
      .from(tripScheduleDays)
      .where(eq(tripScheduleDays.tripId, tripId));
    const proposedDays =
      days.length > 0 ? days : [{ startsAt: trip.startsAt, endsAt: trip.endsAt }];
    if (valid.length > 0) {
      const conflict = await tx
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
        .where(
          and(
            eq(trips.shopId, shopId),
            ne(trips.id, tripId),
            inArray(tripAssignments.personId, valid),
            or(
              ...proposedDays.map((day) =>
                and(
                  lt(sql`coalesce(${tripScheduleDays.startsAt}, ${trips.startsAt})`, day.endsAt),
                  gt(sql`coalesce(${tripScheduleDays.endsAt}, ${trips.endsAt})`, day.startsAt),
                ),
              ),
            ),
          ),
        )
        .limit(1);
      if (conflict.length > 0) return false;
    }
    await tx.delete(tripAssignments).where(eq(tripAssignments.tripId, tripId));
    if (valid.length > 0) {
      await tx.insert(tripAssignments).values(valid.map((personId) => ({ tripId, personId })));
    }
    return true;
  });
}

export type TripCrewChange = {
  personId: string;
  operation: "assign" | "unassign";
};

/**
 * Apply one crew assignment change without replacing concurrent assignments.
 * The trip and person are both tenant-checked inside the transaction.
 */
export async function changeTripCrew(
  db: AppDb,
  shopId: string,
  tripId: string,
  change: TripCrewChange,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [eligible] = await tx
      .select({ personId: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .innerJoin(trips, eq(trips.id, tripId))
      .where(
        and(
          eq(trips.shopId, shopId),
          eq(people.shopId, shopId),
          eq(people.id, change.personId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!eligible) return false;

    const [targetTrip] = await tx
      .select({ courseId: trips.courseId })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
      .limit(1)
      .for("update");
    if (!targetTrip) return false;
    if (targetTrip.courseId) {
      const current = await tx
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, tripId));
      const proposed = new Set(current.map((row) => row.personId));
      if (change.operation === "assign") proposed.add(change.personId);
      else proposed.delete(change.personId);
      const roles = proposed.size
        ? await tx
            .select({ personId: personRoles.personId, role: personRoles.role })
            .from(personRoles)
            .where(inArray(personRoles.personId, [...proposed]))
        : [];
      const roleSets = new Map<string, string[]>();
      for (const role of roles) {
        const personRolesForMember = roleSets.get(role.personId) ?? [];
        personRolesForMember.push(role.role);
        roleSets.set(role.personId, personRolesForMember);
      }
      const review = reviewManifestChange({
        courseRequiresInstructor: true,
        proposedCrew: [...roleSets.values()].map((memberRoles) => ({ roles: memberRoles })),
      });
      if (review.blocking) return false;
      const instructors = new Set(
        roles.filter((row) => row.role === "instructor").map((row) => row.personId),
      );
      if (instructors.size === 0) return false;
      const [course] = await tx
        .select()
        .from(courses)
        .where(and(eq(courses.id, targetTrip.courseId), eq(courses.shopId, shopId)))
        .limit(1);
      const assistants = new Set(
        roles
          .filter((row) => row.role === "divemaster" && !instructors.has(row.personId))
          .map((row) => row.personId),
      );
      // One definition of "which ratio does this session carry" (src/lib/course-ratios.ts)
      // — null means it carries none.
      const seatCap = courseSeatCapacity(course ?? null, instructors.size, assistants.size);
      if (seatCap !== null) {
        const [{ bookedCount }] = await tx
          .select({ bookedCount: count() })
          .from(bookings)
          .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")));
        if (bookedCount > seatCap) return false;
      }
    }

    if (change.operation === "assign") {
      const proposedDays = await tx
        .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, tripId))
        .orderBy(asc(tripScheduleDays.dayNumber));
      const effectiveDays =
        proposedDays.length > 0
          ? proposedDays
          : await tx
              .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
              .from(trips)
              .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
              .limit(1);
      const conflict = await tx
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
        .leftJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
        .where(
          and(
            eq(trips.shopId, shopId),
            ne(trips.id, tripId),
            eq(tripAssignments.personId, change.personId),
            or(
              ...effectiveDays.map((day) =>
                and(
                  lt(sql`coalesce(${tripScheduleDays.startsAt}, ${trips.startsAt})`, day.endsAt),
                  gt(sql`coalesce(${tripScheduleDays.endsAt}, ${trips.endsAt})`, day.startsAt),
                ),
              ),
            ),
          ),
        )
        .limit(1);
      if (conflict.length > 0) return false;
      await tx
        .insert(tripAssignments)
        .values({ tripId, personId: change.personId })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(tripAssignments)
        .where(
          and(eq(tripAssignments.tripId, tripId), eq(tripAssignments.personId, change.personId)),
        );
    }
    return true;
  });
}
/**
 * Divers on a trip: non-cancelled bookings with their people, oldest first.
 * `bookings` carries its own `shop_id` (CR-007) — filtered directly rather
 * than joined through `trips`, so this can never be called safely with only
 * a trip UUID for the wrong shop.
 */
export async function getTripRoster(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ booking: bookings, person: people })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.tripId, tripId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .orderBy(asc(bookings.createdAt));
}

/**
 * Wait-list entries stay outside the roster because they have not booked a
 * seat. `trip_waitlist_entries` carries its own `shop_id` (CR-007).
 */
export async function getTripWaitlist(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ entry: tripWaitlistEntries, person: people })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .where(and(eq(tripWaitlistEntries.tripId, tripId), eq(tripWaitlistEntries.shopId, shopId)))
    .orderBy(asc(tripWaitlistEntries.createdAt));
}

/**
 * Confirmation pages render only a real entry, never an identity in the URL.
 * `trip_waitlist_entries` carries its own `shop_id` (CR-007).
 */
export async function getWaitlistEntryForTrip(
  db: AppDb,
  shopId: string,
  tripId: string,
  entryId: string,
) {
  const [row] = await db
    .select({ entry: tripWaitlistEntries, person: people })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .where(
      and(
        eq(tripWaitlistEntries.id, entryId),
        eq(tripWaitlistEntries.tripId, tripId),
        eq(tripWaitlistEntries.shopId, shopId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type TripWithBookedCount = typeof trips.$inferSelect & {
  booked: number;
  course: typeof courses.$inferSelect | null;
  diveSite: typeof diveSites.$inferSelect | null;
};

/**
 * Upcoming scheduled trips with their active-booking counts.
 * Cancelled bookings free the spot; every other status holds one.
 */
export async function upcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<TripWithBookedCount[]> {
  const rows = await db
    .select({
      trip: trips,
      course: courses,
      diveSite: diveSites,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)))
    .groupBy(trips.id, courses.id, diveSites.id)
    .orderBy(asc(trips.startsAt));

  return rows.map(({ trip, course, diveSite, booked }) => ({ ...trip, course, diveSite, booked }));
}

/**
 * Trip ids relevant to the offline-manifest auto-save window (see ADR
 * 20260726-shopwide-offline-manifest-priming): every scheduled trip that
 * hasn't ended yet and starts at or before `until`. Deliberately not
 * `startsAt >= now` like upcomingTripsWithCounts — a trip already underway
 * (departed, not yet ended) still needs its after-dive-checkpoint copy
 * auto-saved, which is exactly the scenario this feature exists to cover; a
 * lower-only bound would keep excluding it until someone opened its live
 * manifest by hand. Bounded by `until` in the query itself (not filtered
 * after fetching every future trip) since this is polled every five minutes
 * from every open staff tab.
 */
export async function listTripIdsInOfflineManifestWindow(
  db: AppDb,
  shopId: string,
  now: Date,
  until: Date,
): Promise<string[]> {
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.endsAt, now),
        lte(trips.startsAt, until),
      ),
    )
    .orderBy(asc(trips.startsAt));
  return rows.map((row) => row.id);
}

export const SCHEDULE_PAGE_SIZE = 20;

/**
 * The schedule page's list, one keyset page at a time (ordered by departure,
 * then id for a stable tiebreak). `upcomingTripsWithCounts` stays for callers
 * that genuinely need every upcoming trip in memory; the page never should —
 * a busy shop's board grows without bound.
 *
 * `monthStart`/`monthEnd` bound the page to a single shop-local month — the
 * diver calendar passes both when it's on an explicit `?month=` so the list
 * below it shows the same month instead of drifting back to "next N trips
 * from now" (the calendar/list desync this closes).
 */
export async function pagedUpcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  options: {
    cursor?: string;
    limit?: number;
    now?: Date;
    monthStart?: Date;
    monthEnd?: Date;
    /** Only trips with at least one open seat (booked < capacity). */
    hasSpace?: boolean;
    /** "fun_dive" for no linked course, "course" for a course session. */
    tripType?: "fun_dive" | "course";
  } = {},
): Promise<{ trips: TripWithBookedCount[]; nextCursor: string | null }> {
  const now = options.now ?? nowDate();
  const limit = options.limit ?? SCHEDULE_PAGE_SIZE;
  const after = decodeCursor(options.cursor);
  const afterDate = after ? new Date(after[0]) : null;
  const lowerBound = options.monthStart && options.monthStart > now ? options.monthStart : now;

  const rows = await db
    .select({
      trip: trips,
      course: courses,
      diveSite: diveSites,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .leftJoin(diveSites, eq(diveSites.id, trips.diveSiteId))
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, lowerBound),
        options.monthEnd ? lt(trips.startsAt, options.monthEnd) : undefined,
        options.tripType === "fun_dive" ? isNull(trips.courseId) : undefined,
        options.tripType === "course" ? isNotNull(trips.courseId) : undefined,
        afterDate && after && !Number.isNaN(afterDate.getTime())
          ? or(
              gt(trips.startsAt, afterDate),
              and(eq(trips.startsAt, afterDate), gt(trips.id, after[1])),
            )
          : undefined,
      ),
    )
    .groupBy(trips.id, courses.id, diveSites.id)
    .having(options.hasSpace ? sql`count(${bookings.id}) < ${trips.capacity}` : undefined)
    .orderBy(asc(trips.startsAt), asc(trips.id))
    .limit(limit + 1);

  const page = rows
    .slice(0, limit)
    .map(({ trip, course, diveSite, booked }) => ({ ...trip, course, diveSite, booked }));
  const last = page.at(-1);
  return {
    trips: page,
    nextCursor:
      rows.length > limit && last ? encodeCursor(last.startsAt.toISOString(), last.id) : null,
  };
}

/** The crew assigned to each of these trips, in one query, grouped by trip. */
export async function tripCrewByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: string[],
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({ tripId: tripAssignments.tripId, personId: people.id, name: people.fullName })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .innerJoin(people, eq(people.id, tripAssignments.personId))
    .where(and(eq(trips.shopId, shopId), inArray(tripAssignments.tripId, tripIds)))
    .orderBy(asc(people.fullName));
  const byTrip = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of rows) {
    const list = byTrip.get(row.tripId) ?? [];
    list.push({ id: row.personId, name: row.name });
    byTrip.set(row.tripId, list);
  }
  return byTrip;
}

/**
 * How many meeting windows each of these trips has, in one query.
 *
 * The schedule builder needs it to warn before sliding a three-day course as a
 * block; asking per row would be one round trip per departure on the board.
 * Trips with no rows at all are simply absent from the map — callers read that
 * as the single implicit day every trip is created with.
 */
export async function tripScheduleDayCounts(
  db: DbExecutor,
  tripIds: string[],
): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({ tripId: tripScheduleDays.tripId, days: count() })
    .from(tripScheduleDays)
    .where(inArray(tripScheduleDays.tripId, tripIds))
    .groupBy(tripScheduleDays.tripId);
  return new Map(rows.map((row) => [row.tripId, row.days]));
}

/**
 * Board-wide aggregates for the staff stat tiles, computed in the database so
 * they stay exact when the list itself is paged.
 */
export async function upcomingScheduleStats(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<{ departures: number; booked: number; openSeats: number; atCapacity: number }> {
  const perTrip = db
    .select({
      tripId: trips.id,
      capacity: trips.capacity,
      booked: count(bookings.id).as("booked"),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)))
    .groupBy(trips.id)
    .as("per_trip");

  const [row] = await db
    .select({
      departures: count(),
      booked: sql<number>`coalesce(sum(${perTrip.booked}), 0)::int`,
      capacity: sql<number>`coalesce(sum(${perTrip.capacity}), 0)::int`,
      atCapacity: sql<number>`count(*) filter (where ${perTrip.booked} >= ${perTrip.capacity})::int`,
    })
    .from(perTrip);

  const departures = row?.departures ?? 0;
  const booked = row?.booked ?? 0;
  return {
    departures,
    booked,
    openSeats: Math.max(0, (row?.capacity ?? 0) - booked),
    atCapacity: row?.atCapacity ?? 0,
  };
}

/**
 * First and last upcoming departure, to pick the calendar's default month and
 * bound its pager without loading a single trip row.
 */
export async function upcomingScheduleRange(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<{ first: Date | null; last: Date | null }> {
  const [range] = await db
    .select({
      first: sql<string | null>`min(${trips.startsAt})`,
      last: sql<string | null>`max(${trips.startsAt})`,
    })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)));
  return {
    first: range?.first ? new Date(range.first) : null,
    last: range?.last ? new Date(range.last) : null,
  };
}

/**
 * The diver calendar's month of trips, bounded to the shop-local month so the
 * grid stays complete no matter how the list below it is paged.
 */
export async function upcomingTripsForCalendar(
  db: AppDb,
  shopId: string,
  monthStartUtc: Date,
  monthEndUtc: Date,
  now: Date = nowDate(),
): Promise<{ id: string; title: string; startsAt: Date; capacity: number; booked: number }[]> {
  const from = monthStartUtc > now ? monthStartUtc : now;
  return db
    .select({
      id: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, from),
        lt(trips.startsAt, monthEndUtc),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));
}

export type StaffScheduleDay = {
  dayNumber: number;
  startsAt: Date;
  endsAt: Date;
};

export type StaffScheduleTrip = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  courseTitle: string | null;
  days: StaffScheduleDay[];
  crew: Array<{ id: string; name: string; roles: string[] }>;
};

/**
 * The staff board's bounded month query. A multi-day class is returned once,
 * with each meeting window preserved, and crew is grouped by person so the UI
 * can show both an individual's commitments and an owner's coverage gaps.
 */
export async function upcomingStaffSchedule(
  db: DbExecutor,
  shopId: string,
  monthStartUtc: Date,
  monthEndUtc: Date,
  now: Date = nowDate(),
): Promise<StaffScheduleTrip[]> {
  const rows = await db
    .select({
      trip: trips,
      courseTitle: courses.title,
      day: tripScheduleDays,
      personId: people.id,
      personName: people.fullName,
      role: personRoles.role,
    })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .innerJoin(tripScheduleDays, eq(tripScheduleDays.tripId, trips.id))
    .leftJoin(tripAssignments, eq(tripAssignments.tripId, trips.id))
    .leftJoin(people, eq(people.id, tripAssignments.personId))
    .leftJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        gte(trips.endsAt, now),
        lt(tripScheduleDays.startsAt, monthEndUtc),
        gt(tripScheduleDays.endsAt, monthStartUtc),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(tripScheduleDays.dayNumber), asc(people.fullName));

  const byTrip = new Map<string, StaffScheduleTrip>();
  const daysByTrip = new Map<string, Map<number, StaffScheduleDay>>();
  const crewByTrip = new Map<string, Map<string, { id: string; name: string; roles: string[] }>>();
  for (const row of rows) {
    const existing = byTrip.get(row.trip.id) ?? {
      id: row.trip.id,
      title: row.trip.title,
      startsAt: row.trip.startsAt,
      endsAt: row.trip.endsAt,
      courseTitle: row.courseTitle,
      days: [],
      crew: [],
    };
    byTrip.set(row.trip.id, existing);

    const days = daysByTrip.get(row.trip.id) ?? new Map<number, StaffScheduleDay>();
    days.set(row.day.dayNumber, {
      dayNumber: row.day.dayNumber,
      startsAt: row.day.startsAt,
      endsAt: row.day.endsAt,
    });
    daysByTrip.set(row.trip.id, days);

    if (row.personId && row.personName) {
      const crew =
        crewByTrip.get(row.trip.id) ??
        new Map<string, { id: string; name: string; roles: string[] }>();
      const member = crew.get(row.personId) ?? {
        id: row.personId,
        name: row.personName,
        roles: [],
      };
      if (row.role && !member.roles.includes(row.role)) member.roles.push(row.role);
      crew.set(row.personId, member);
      crewByTrip.set(row.trip.id, crew);
    }
  }

  return [...byTrip.values()].map((trip) => ({
    ...trip,
    days: [...(daysByTrip.get(trip.id)?.values() ?? [])].sort((a, b) => a.dayNumber - b.dayNumber),
    crew: [...(crewByTrip.get(trip.id)?.values() ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  }));
}

/**
 * The sessions a public course page offers to book. Seats left comes from the
 * same booked-count shape the schedule uses, so a full session reads as full
 * here too rather than sending a diver to a dead end.
 */
export async function listUpcomingSessionsForCourse(
  db: AppDb,
  shopId: string,
  courseId: string,
  now: Date = nowDate(),
) {
  const rows = await db
    .select({ trip: trips, booked: count(bookings.id) })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.courseId, courseId),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, now),
      ),
    )
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));
  return rows.map(({ trip, booked }) => ({ ...trip, booked }));
}
