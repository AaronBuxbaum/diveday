import { and, asc, count, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import type { AppDb, DbExecutor } from "./client";
import {
  bookings,
  courses,
  diveSites,
  people,
  personRoles,
  shops,
  tripAssignments,
  tripDives,
  tripRequirements,
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

export async function createTrip(db: AppDb, input: NewTrip) {
  return db.transaction(async (tx) => {
    const plannedDives = normalizedDiveCount(input.plannedDives);
    if (!plannedDives) return null;
    const drafts = normalizedDiveDrafts(
      plannedDives,
      input.dives ?? (input.diveSiteId ? [{ diveSiteId: input.diveSiteId }] : undefined),
    );
    if (!(await validateDiveSites(tx, input.shopId, drafts))) return null;
    const course = input.courseId
      ? (
          await tx
            .select()
            .from(courses)
            .where(
              and(
                eq(courses.id, input.courseId),
                eq(courses.shopId, input.shopId),
                eq(courses.isActive, true),
              ),
            )
            .limit(1)
        )[0]
      : null;
    if (input.courseId && !course) return null;
    const primaryDiveSiteId = drafts[0]?.diveSiteId ?? null;
    const [trip] = await tx
      .insert(trips)
      .values({
        shopId: input.shopId,
        courseId: input.courseId,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        capacity: input.capacity,
        priceCents: input.priceCents,
        plannedDives,
        diveSiteId: primaryDiveSiteId,
      })
      .returning();
    if (!trip) throw new Error("createTrip: insert returned no row");
    await tx.insert(tripDives).values(drafts.map((draft) => ({ tripId: trip.id, ...draft })));
    // A missing requirement configuration is a readiness blocker, never an
    // accidental pass. Course sessions snapshot their catalog baseline so a
    // later catalog edit cannot silently weaken an already-published session.
    await tx.insert(tripRequirements).values({
      tripId: trip.id,
      shopId: input.shopId,
      requiresWaiver: course?.requiresWaiver ?? true,
      minimumCertificationLevel: course?.minimumCertificationLevel ?? "open_water",
    });
    return trip;
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
      conditionsUpdatedAt: new Date(),
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

/**
 * A booking on a specific trip, with its person — for the confirmation
 * panel, which must render from the database, never from URL params.
 */
export async function getBookingForTrip(db: AppDb, tripId: string, bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, person: people })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.tripId, tripId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function restoreBooking(db: AppDb, shopId: string, bookingId: string) {
  const [booking] = await db
    .update(bookings)
    .set({ status: "booked" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .returning();
  return booking ?? null;
}

export async function cancelBooking(db: AppDb, shopId: string, bookingId: string) {
  const [booking] = await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .returning();
  return booking ?? null;
}

export async function getShopBySlug(db: AppDb, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop ?? null;
}

export async function getShopById(db: AppDb, id: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.id, id)).limit(1);
  return shop ?? null;
}

/** Sets which diver medical questionnaire the shop's waivers present. */
export async function setShopJurisdiction(db: AppDb, shopId: string, jurisdiction: "rstc" | "uk") {
  const [shop] = await db
    .update(shops)
    .set({ jurisdiction })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/** Replaces the shop-wide diver packing checklist after route-level validation. */
export async function setShopPackingList(db: AppDb, shopId: string, packingList: string[]) {
  const [shop] = await db
    .update(shops)
    .set({ packingList })
    .where(eq(shops.id, shopId))
    .returning();
  return shop ?? null;
}

/**
 * The shop public pages serve. Single-shop instance for now — multi-shop
 * routing (slug subpaths or domains) arrives with shop onboarding.
 */
export async function getDefaultShop(db: AppDb) {
  const [shop] = await db.select().from(shops).orderBy(asc(shops.createdAt)).limit(1);
  return shop ?? null;
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
  now: Date = new Date(),
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
