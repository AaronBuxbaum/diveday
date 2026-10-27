import { and, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The three reads the waiver signing page (`src/app/waivers/[token]`) makes
 * beyond the waiver record itself. Each is keyed by an id the bearer token has
 * already resolved — the token's own booking or person — so none of them
 * widens what the link discloses. Each also takes the record's shop and
 * filters on it, so an id that somehow named another shop's row reads as
 * nothing rather than leaking across tenants.
 */

/**
 * Whether the seat a release is for was marked "Under 18" by whoever booked it
 * (`bookings.minor_declared_at`). False for a person-scoped release, which has
 * no seat. The guardian rule reads it only where no date of birth is on file
 * (`guardianSignatureRequired`), so the signing page and `completeWaiver` ask
 * the same question.
 */
export async function seatMinorDeclared(
  db: DbExecutor,
  shopId: string,
  bookingId: string | null,
): Promise<boolean> {
  if (!bookingId) return false;
  const [row] = await db
    .select({ minorDeclaredAt: bookings.minorDeclaredAt })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return Boolean(row?.minorDeclaredAt);
}

/** The departure a booking sits on, or null when the booking is gone. */
export async function getBookingTripId(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  return row?.tripId ?? null;
}

/**
 * The name a release has to be signed under, and what the guardian rule reads:
 * the date of birth on file and the seat's "Under 18" (`seatMinorDeclared`).
 */
export async function getWaiverSignerOnFile(
  db: DbExecutor,
  record: { shopId: string; personId: string; bookingId: string | null },
): Promise<{ fullName: string; dateOfBirth: string | null; minorDeclared: boolean } | undefined> {
  const [row] = await db
    .select({ fullName: people.fullName, dateOfBirth: people.dateOfBirth })
    .from(people)
    // diveday:allow-deleted-people: the signer of a release already issued.
    .where(and(eq(people.id, record.personId), eq(people.shopId, record.shopId)))
    .limit(1);
  if (!row) return undefined;
  const minorDeclared = await seatMinorDeclared(db, record.shopId, record.bookingId);
  return { ...row, minorDeclared };
}

/** The trip a booking's waiver is for, named on the page so the diver can check it. */
export async function getWaiverTripHeader(db: DbExecutor, shopId: string, bookingId: string) {
  const [row] = await db
    .select({ title: trips.title, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  return row ?? null;
}
