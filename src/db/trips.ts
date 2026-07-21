import { and, asc, count, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import type { TripRecurrenceFrequency } from "@/lib/recurrence";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import type { Course } from "./schema";
import {
  bookings,
  courses,
  diveSites,
  people,
  personRoles,
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
 * the trip is a one-off.
 */
export async function getTripSeriesSummary(db: AppDb, shopId: string, tripId: string) {
  const [row] = await db
    .select({ series: tripSeries })
    .from(trips)
    .innerJoin(tripSeries, eq(tripSeries.id, trips.seriesId))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  const counts = await db
    .select({ scheduled: count(trips.id) })
    .from(trips)
    .where(and(eq(trips.seriesId, row.series.id), eq(trips.status, "scheduled")));
  return { ...row.series, scheduledCount: counts[0]?.scheduled ?? 0 };
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

export async function updateTrip(db: AppDb, shopId: string, tripId: string, patch: TripPatch) {
  return db.transaction(async (tx) => {
    const plannedDives = normalizedDiveCount(patch.plannedDives);
    if (!plannedDives) return null;
    const drafts = patch.dives ? normalizedDiveDrafts(plannedDives, patch.dives) : undefined;
    const sitesToValidate = drafts ?? (patch.diveSiteId ? [{ diveSiteId: patch.diveSiteId }] : []);
    if (!(await validateDiveSites(tx, shopId, sitesToValidate))) return null;
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
    if (!trip) return null;
    if (drafts) await replaceTripDives(tx, tripId, drafts);
    return trip;
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
