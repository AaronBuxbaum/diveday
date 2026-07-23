import { and, eq, gt, isNull, ne } from "drizzle-orm";
import {
  capabilityExpiryFor,
  createCapabilityToken,
  hashCapabilityToken,
} from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { bookingCapabilities, bookings, trips } from "./schema";

export type CapabilityPurpose = "readiness" | "confirm";

export type IssuedCapability = { token: string; expiresAt: Date };

/**
 * Mints a fresh, purpose-bound bearer capability over a booking. Refuses a
 * booking that isn't this shop's or is already cancelled — a cancelled
 * booking never gets a new link, and any of its outstanding links already
 * fail closed at verify time regardless.
 *
 * Deliberately does not supersede an earlier still-valid capability for the
 * same booking+purpose: a diver may be holding an earlier email's link and a
 * later reminder's link at once, and both should keep working until they
 * individually expire or are explicitly revoked.
 */
export async function issueBookingCapability(
  db: AppDb,
  input: { shopId: string; bookingId: string; purpose: CapabilityPurpose; now?: Date },
): Promise<IssuedCapability | null> {
  const now = input.now ?? nowDate();
  const [booking] = await db
    .select({ id: bookings.id, tripEndsAt: trips.endsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!booking) return null;

  const token = createCapabilityToken();
  const expiresAt = capabilityExpiryFor(booking.tripEndsAt, now);
  await db.insert(bookingCapabilities).values({
    shopId: input.shopId,
    bookingId: input.bookingId,
    purpose: input.purpose,
    tokenHash: hashCapabilityToken(token),
    issuedAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

export type BookingCapabilityContext = {
  bookingId: string;
  shopId: string;
  personId: string;
  tripId: string;
};

/**
 * Resolves a bearer token to its booking context, or null for anything that
 * must read to the caller as "this link isn't available" — unknown token,
 * wrong purpose, expired, revoked, or a since-cancelled booking. Callers
 * must never distinguish these cases in a public response: this function is
 * the one place that decides, so no response elsewhere can leak a
 * booking-existence oracle.
 */
export async function verifyBookingCapability(
  db: DbExecutor,
  input: { token: string; purpose: CapabilityPurpose; now?: Date },
): Promise<BookingCapabilityContext | null> {
  const now = input.now ?? nowDate();
  const tokenHash = hashCapabilityToken(input.token);
  const [row] = await db
    .select({
      bookingId: bookingCapabilities.bookingId,
      capabilityShopId: bookingCapabilities.shopId,
      bookingShopId: bookings.shopId,
      personId: bookings.personId,
      tripId: bookings.tripId,
      bookingStatus: bookings.status,
      tripStatus: trips.status,
    })
    .from(bookingCapabilities)
    .innerJoin(bookings, eq(bookings.id, bookingCapabilities.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookingCapabilities.tokenHash, tokenHash),
        eq(bookingCapabilities.purpose, input.purpose),
        isNull(bookingCapabilities.revokedAt),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Fail closed on a since-cancelled booking even though nothing proactively
  // revoked this row, and defend in depth against the capability's shopId
  // ever drifting from its booking's — nothing legitimate can cause that
  // today, but a verified identity must never be trusted past that check.
  if (row.bookingStatus === "cancelled") return null;
  // Trip cancellation doesn't cascade into cancelling its bookings (a
  // separate, pre-existing gap outside this ticket's scope), so a booking
  // can still read "booked" after the trip itself is called off — a
  // security review of CR-002/CR-003 found this let an outstanding
  // capability keep paying/rental-fit/contact authority for a trip that no
  // longer runs. Fail closed here too, the same way `issueWaiverRequest`
  // already does for waivers (src/db/waivers.ts).
  if (row.tripStatus === "cancelled") return null;
  if (row.capabilityShopId !== row.bookingShopId) return null;
  return {
    bookingId: row.bookingId,
    shopId: row.capabilityShopId,
    personId: row.personId,
    tripId: row.tripId,
  };
}

/**
 * Explicit revocation: invalidates every outstanding, unexpired capability
 * for a booking (optionally scoped to one purpose) immediately, ahead of
 * their natural expiry. Used on cancellation; also the seam a future
 * staff-facing "revoke this link" action would call.
 */
export async function revokeBookingCapabilities(
  db: AppDb,
  input: { shopId: string; bookingId: string; purpose?: CapabilityPurpose; now?: Date },
): Promise<void> {
  const now = input.now ?? nowDate();
  const conditions = [
    eq(bookingCapabilities.shopId, input.shopId),
    eq(bookingCapabilities.bookingId, input.bookingId),
    isNull(bookingCapabilities.revokedAt),
  ];
  if (input.purpose) conditions.push(eq(bookingCapabilities.purpose, input.purpose));
  await db
    .update(bookingCapabilities)
    .set({ revokedAt: now })
    .where(and(...conditions));
}
