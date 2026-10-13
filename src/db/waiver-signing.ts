import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people, trips } from "./schema";

/**
 * The three reads the waiver signing page (`src/app/waivers/[token]`) makes
 * beyond the waiver record itself. Each is keyed by an id the bearer token has
 * already resolved — the token's own booking or person — so none of them
 * widens what the link discloses. Each also takes the record's shop and
 * filters on it, so an id that somehow named another shop's row reads as
 * nothing rather than leaking across tenants.
 */

/** The departure a booking sits on, or null when the booking is gone. */
export async function getBookingTripId(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row?.tripId ?? null;
}

/** The name and date of birth a release has to be signed under. */
export async function getWaiverSignerOnFile(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<{ fullName: string; dateOfBirth: string | null } | undefined> {
  const [row] = await db
    .select({ fullName: people.fullName, dateOfBirth: people.dateOfBirth })
    .from(people)
    // diveday:allow-deleted-people: the signer of a release already issued.
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  return row;
}

/** The trip a booking's waiver is for, named on the page so the diver can check it. */
export async function getWaiverTripHeader(db: DbExecutor, shopId: string, bookingId: string) {
  const [row] = await db
    .select({ title: trips.title, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row ?? null;
}
