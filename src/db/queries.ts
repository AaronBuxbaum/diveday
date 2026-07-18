import { and, asc, count, desc, eq, gte, ne } from "drizzle-orm";
import { newWaiverToken, statusAfterSigning } from "@/lib/waivers";
import type { AppDb } from "./client";
import {
  bookings,
  people,
  shops,
  trips,
  type Waiver,
  type WaiverTemplate,
  waivers,
  waiverTemplates,
} from "./schema";

export async function getShopBySlug(db: AppDb, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
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

export async function getTripById(db: AppDb, tripId: string) {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  return trip ?? null;
}

// --- Waivers (M3) ---------------------------------------------------------

/** The template a shop offers for new signings (most recent active one). */
export async function getActiveWaiverTemplate(
  db: AppDb,
  shopId: string,
): Promise<WaiverTemplate | null> {
  const [template] = await db
    .select()
    .from(waiverTemplates)
    .where(and(eq(waiverTemplates.shopId, shopId), eq(waiverTemplates.active, true)))
    .orderBy(desc(waiverTemplates.createdAt))
    .limit(1);
  return template ?? null;
}

export type WaiverSigningView = {
  waiver: Waiver;
  template: WaiverTemplate;
  diverName: string;
  shopName: string;
  tripTitle: string;
  tripStartsAt: Date;
  shopTimezone: string;
};

/** Everything the public signing page needs, resolved from the link token. */
export async function getWaiverByToken(
  db: AppDb,
  token: string,
): Promise<WaiverSigningView | null> {
  const [row] = await db
    .select({
      waiver: waivers,
      template: waiverTemplates,
      diverName: people.fullName,
      shopName: shops.name,
      shopTimezone: shops.timezone,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(waivers)
    .innerJoin(waiverTemplates, eq(waivers.templateId, waiverTemplates.id))
    .innerJoin(bookings, eq(waivers.bookingId, bookings.id))
    .innerJoin(people, eq(bookings.personId, people.id))
    .innerJoin(trips, eq(bookings.tripId, trips.id))
    .innerJoin(shops, eq(waivers.shopId, shops.id))
    .where(eq(waivers.token, token))
    .limit(1);
  return row ?? null;
}

/**
 * Create the waiver for a booking if one doesn't exist yet, returning the token.
 * One waiver per booking (unique index); idempotent so re-sending a link is safe.
 */
export async function ensureWaiverForBooking(
  db: AppDb,
  input: { shopId: string; bookingId: string; templateId: string },
): Promise<Waiver> {
  const [existing] = await db
    .select()
    .from(waivers)
    .where(eq(waivers.bookingId, input.bookingId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(waivers)
    .values({ ...input, token: newWaiverToken() })
    .returning();
  if (!created) throw new Error("ensureWaiverForBooking: insert returned no row");
  return created;
}

/**
 * Record a signature against a pending waiver. No-op (returns null) if the
 * waiver is already signed or blocked — a link can't be signed twice.
 */
export async function signWaiverByToken(
  db: AppDb,
  token: string,
  input: { signedName: string; medicalFlagged: boolean; medicalNotes: string | null },
): Promise<Waiver | null> {
  const [updated] = await db
    .update(waivers)
    .set({
      status: statusAfterSigning(input.medicalFlagged),
      signedName: input.signedName,
      signedAt: new Date(),
      medicalFlagged: input.medicalFlagged,
      medicalNotes: input.medicalNotes,
    })
    .where(and(eq(waivers.token, token), eq(waivers.status, "pending")))
    .returning();
  return updated ?? null;
}

export type RosterEntry = {
  booking: typeof bookings.$inferSelect;
  personId: string;
  diverName: string;
  waiver: Waiver | null;
};

/**
 * The active roster for a trip: every non-cancelled booking with its diver and
 * waiver, sorted by name. The spine the check-in view and manifest read from.
 */
export async function tripRoster(db: AppDb, tripId: string): Promise<RosterEntry[]> {
  const rows = await db
    .select({ booking: bookings, personId: people.id, diverName: people.fullName, waiver: waivers })
    .from(bookings)
    .innerJoin(people, eq(bookings.personId, people.id))
    .leftJoin(waivers, eq(waivers.bookingId, bookings.id))
    .where(and(eq(bookings.tripId, tripId), ne(bookings.status, "cancelled")))
    .orderBy(asc(people.fullName));
  return rows.map((r) => ({
    booking: r.booking,
    personId: r.personId,
    diverName: r.diverName,
    waiver: r.waiver,
  }));
}

/** Staff records a physician's sign-off, lifting the boarding block. */
export async function recordPhysicianClearance(
  db: AppDb,
  waiverId: string,
): Promise<Waiver | null> {
  const [updated] = await db
    .update(waivers)
    .set({ status: "signed", physicianClearedAt: new Date() })
    .where(and(eq(waivers.id, waiverId), eq(waivers.status, "physician_required")))
    .returning();
  return updated ?? null;
}
