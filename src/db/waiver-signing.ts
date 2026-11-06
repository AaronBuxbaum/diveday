import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { seatNotCancelled } from "./trips-queries";

/**
 * The three reads the waiver signing page (`src/app/(token)/waivers/[token]`) makes
 * beyond the waiver record itself. Each is keyed by an id the bearer token has
 * already resolved — the token's own booking or person — so none of them
 * widens what the link discloses. Each also takes the record's shop and
 * filters on it, so an id that somehow named another shop's row reads as
 * nothing rather than leaking across tenants.
 */

/**
 * Whether the booker marked the release's diver "Under 18"
 * (`bookings.minor_declared_at`): on the release's own seat, or, for a
 * release with no seat (which covers every seat the diver holds once signed,
 * issue #4019), on any of their seats not cancelled on a live departure. The
 * guardian rule reads it only where no date of birth is on file
 * (`guardianSignatureRequired`), so the signing page, `completeWaiver` and
 * Copy link ask the same question.
 */
export async function seatMinorDeclared(
  db: DbExecutor,
  record: { shopId: string; personId: string; bookingId: string | null },
): Promise<boolean> {
  if (record.bookingId) {
    const [row] = await db
      .select({ minorDeclaredAt: bookings.minorDeclaredAt })
      .from(bookings)
      .where(and(eq(bookings.id, record.bookingId), eq(bookings.shopId, record.shopId)))
      .limit(1);
    return Boolean(row?.minorDeclaredAt);
  }
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, record.shopId),
        eq(bookings.personId, record.personId),
        isNotNull(bookings.minorDeclaredAt),
        seatNotCancelled,
        eq(trips.shopId, record.shopId),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Whether any of the person's seats not cancelled on a live departure carries
 * an address the party's lead typed and the member never claimed
 * (`seatAddressIsLeadTyped`, issue #4003). The contact on file may then be
 * that typed one, which cannot prove a guardian (issue #4019).
 */
export async function personContactLeadTyped(
  db: DbExecutor,
  shopId: string,
  personId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, personId),
        isNotNull(bookings.contactTypedByLeadAt),
        isNull(bookings.claimedAt),
        seatNotCancelled,
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  return Boolean(row);
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
        seatNotCancelled,
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
 * the date of birth on file and the booker's "Under 18" (`seatMinorDeclared`).
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
  const minorDeclared = await seatMinorDeclared(db, record);
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
        seatNotCancelled,
        eq(trips.shopId, shopId),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .limit(1);
  return row ?? null;
}
