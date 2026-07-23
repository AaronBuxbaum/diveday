import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { maxRecordedDiveNumber } from "@/lib/manifests";
import type { TripRecurrenceFrequency } from "@/lib/recurrence";
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
  tripAssignments,
  tripDives,
  tripRequirements,
  tripSeries,
  trips,
  tripWaitlistEntries,
} from "./schema";

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

    let updated = 0;
    let skipped = 0;
    for (const sibling of siblings) {
      if (source.capacity < sibling.booked) {
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
  | {
      ok: false;
      reason: "invalid" | "not_found" | "capacity_below_booked" | "planned_dives_below_history";
      /** Present only for the two below-invariant reasons, for a specific staff message. */
      detail?: { bookedCount: number } | { recordedDiveCount: number };
    };

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
      .select({ checkpoint: rollCallEvents.checkpoint })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.tripId, tripId));
    const recordedDiveCount = maxRecordedDiveNumber(checkpointRows.map((row) => row.checkpoint));
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
  const [trip] = await db
    .update(trips)
    .set({
      conditionsSummary: patch.conditionsSummary || null,
      waterTemperatureC: patch.waterTemperatureC ?? null,
      visibilityMeters: patch.visibilityMeters ?? null,
      surfaceConditions: patch.surfaceConditions || null,
      conditionsUpdatedAt: nowDate(),
    })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .returning();
  return trip ?? null;
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

export async function getTripCrewIds(db: AppDb, tripId: string): Promise<string[]> {
  const rows = await db
    .select({ personId: tripAssignments.personId })
    .from(tripAssignments)
    .where(eq(tripAssignments.tripId, tripId));
  return rows.map((r) => r.personId);
}

/** Replace a trip's crew. Only people with a staff role in the shop stick. */
export async function setTripCrew(db: AppDb, shopId: string, tripId: string, personIds: string[]) {
  const staff = await listStaff(db, shopId);
  const valid = personIds.filter((id) => staff.some((s) => s.person.id === id));
  await db.transaction(async (tx) => {
    await tx.delete(tripAssignments).where(eq(tripAssignments.tripId, tripId));
    if (valid.length > 0) {
      await tx.insert(tripAssignments).values(valid.map((personId) => ({ tripId, personId })));
    }
  });
}

/** Divers on a trip: non-cancelled bookings with their people, oldest first. */
export async function getTripRoster(db: AppDb, tripId: string) {
  return db
    .select({ booking: bookings, person: people })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")))
    .orderBy(asc(bookings.createdAt));
}

/** Wait-list entries stay outside the roster because they have not booked a seat. */
export async function getTripWaitlist(db: AppDb, tripId: string) {
  return db
    .select({ entry: tripWaitlistEntries, person: people })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .where(eq(tripWaitlistEntries.tripId, tripId))
    .orderBy(asc(tripWaitlistEntries.createdAt));
}

/** Confirmation pages render only a real entry, never an identity in the URL. */
export async function getWaitlistEntryForTrip(db: AppDb, tripId: string, entryId: string) {
  const [row] = await db
    .select({ entry: tripWaitlistEntries, person: people })
    .from(tripWaitlistEntries)
    .innerJoin(people, eq(people.id, tripWaitlistEntries.personId))
    .where(and(eq(tripWaitlistEntries.id, entryId), eq(tripWaitlistEntries.tripId, tripId)))
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

export const SCHEDULE_PAGE_SIZE = 50;

/**
 * The schedule page's list, one keyset page at a time (ordered by departure,
 * then id for a stable tiebreak). `upcomingTripsWithCounts` stays for callers
 * that genuinely need every upcoming trip in memory; the page never should —
 * a busy shop's board grows without bound.
 */
export async function pagedUpcomingTripsWithCounts(
  db: AppDb,
  shopId: string,
  options: { cursor?: string; limit?: number; now?: Date } = {},
): Promise<{ trips: TripWithBookedCount[]; nextCursor: string | null }> {
  const now = options.now ?? nowDate();
  const limit = options.limit ?? SCHEDULE_PAGE_SIZE;
  const after = decodeCursor(options.cursor);
  const afterDate = after ? new Date(after[0]) : null;

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
        gte(trips.startsAt, now),
        afterDate && after && !Number.isNaN(afterDate.getTime())
          ? or(
              gt(trips.startsAt, afterDate),
              and(eq(trips.startsAt, afterDate), gt(trips.id, after[1])),
            )
          : undefined,
      ),
    )
    .groupBy(trips.id, courses.id, diveSites.id)
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
