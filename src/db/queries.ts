import { and, asc, count, eq, gte, inArray, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import type { AppDb } from "./client";
import { bookings, people, personRoles, shops, tripAssignments, trips } from "./schema";

export type NewTrip = {
  shopId: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
};

export async function createTrip(db: AppDb, input: NewTrip) {
  const [trip] = await db.insert(trips).values(input).returning();
  if (!trip) throw new Error("createTrip: insert returned no row");
  return trip;
}

/** Trip scoped to a shop (staff pages must never cross tenants), with booked count. */
export async function getTripWithBooked(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ trip: trips, booked: count(bookings.id) })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)))
    .groupBy(trips.id)
    .limit(1);
  const row = rows[0];
  return row ? { ...row.trip, booked: row.booked } : null;
}

export type TripPatch = {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
};

export async function updateTrip(db: AppDb, shopId: string, tripId: string, patch: TripPatch) {
  const [trip] = await db
    .update(trips)
    .set({ ...patch, description: patch.description ?? null })
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

/**
 * The shop public pages serve. Single-shop instance for now — multi-shop
 * routing (slug subpaths or domains) arrives with shop onboarding.
 */
export async function getDefaultShop(db: AppDb) {
  const [shop] = await db.select().from(shops).orderBy(asc(shops.createdAt)).limit(1);
  return shop ?? null;
}

export type TripWithBookedCount = typeof trips.$inferSelect & { booked: number };

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
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(and(eq(trips.shopId, shopId), eq(trips.status, "scheduled"), gte(trips.startsAt, now)))
    .groupBy(trips.id)
    .orderBy(asc(trips.startsAt));

  return rows.map(({ trip, booked }) => ({ ...trip, booked }));
}
