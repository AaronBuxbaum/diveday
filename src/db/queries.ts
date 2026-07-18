import { and, asc, count, eq, gte, inArray, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import type { AppDb } from "./client";
import {
  bookings,
  courses,
  diveSites,
  people,
  personRoles,
  shops,
  tripAssignments,
  tripRequirements,
  trips,
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
};

export async function createTrip(db: AppDb, input: NewTrip) {
  return db.transaction(async (tx) => {
    const course = input.courseId
      ? (
          await tx
            .select()
            .from(courses)
            .where(and(eq(courses.id, input.courseId), eq(courses.shopId, input.shopId)))
            .limit(1)
        )[0]
      : null;
    if (input.courseId && !course) return null;
    const site = input.diveSiteId
      ? (
          await tx
            .select({ id: diveSites.id })
            .from(diveSites)
            .where(and(eq(diveSites.id, input.diveSiteId), eq(diveSites.shopId, input.shopId)))
            .limit(1)
        )[0]
      : null;
    if (input.diveSiteId && !site) return null;
    const [trip] = await tx.insert(trips).values(input).returning();
    if (!trip) throw new Error("createTrip: insert returned no row");
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
  diveSiteId?: string | null;
};

export async function updateTrip(db: AppDb, shopId: string, tripId: string, patch: TripPatch) {
  if (patch.diveSiteId) {
    const [site] = await db
      .select({ id: diveSites.id })
      .from(diveSites)
      .where(and(eq(diveSites.id, patch.diveSiteId), eq(diveSites.shopId, shopId)))
      .limit(1);
    if (!site) return null;
  }
  const [trip] = await db
    .update(trips)
    .set({
      ...patch,
      description: patch.description ?? null,
      ...(patch.diveSiteId === undefined ? {} : { diveSiteId: patch.diveSiteId }),
    })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .returning();
  return trip ?? null;
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
