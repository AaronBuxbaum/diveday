import { and, eq, ne, sql } from "drizzle-orm";
import { bookingIdFromBuddyReferral } from "@/lib/buddy-tokens";
import type { DbExecutor } from "./client";
import { bookingReferrals, bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Which diver's link brought this seat** (ADR 20260908-one-hand, decision 6,
 * lever W: the buddy seat).
 *
 * The recap ends on "Bring a buddy next time" and the link carries a non-secret
 * id derived from the recapping diver's own booking. This module is the two
 * ends of that: resolve an id that arrived with a booking, and count the seats
 * that arrived with one.
 *
 * **Ignoring junk is the contract, not a fallback.** A mangled paste, another
 * shop's id, a hand-typed guess: the seat books exactly as an unreferred one
 * does and no row is written. Nothing about a booking ever depends on this.
 */

/**
 * The booking a `?via=` names, if it names one of *this shop's* live seats.
 *
 * Three conditions and each is load-bearing. The id must verify
 * (`bookingIdFromBuddyReferral`), so a stranger cannot credit a booking they
 * guessed. It must be this shop's — one cookie covers the whole `/s/`
 * namespace, so a diver carrying shop A's link who books at shop B must not
 * hand shop B a number about shop A. And it must not be the new booking itself,
 * which is the one self-reference the shape allows.
 */
export async function resolveBuddyReferral(
  tx: DbExecutor,
  input: { shopId: string; referralId: string | null | undefined; bookingId: string },
): Promise<string | null> {
  const referredByBookingId = bookingIdFromBuddyReferral(input.referralId);
  if (!referredByBookingId || referredByBookingId === input.bookingId) return null;
  const [row] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), liveTrip()))
    .where(and(eq(bookings.id, referredByBookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Record where a seat came from, when it came from a diver's own link.
 *
 * Best-effort by construction: the caller runs it after the seat is committed,
 * and a referral that cannot be resolved or written is a count the shop does
 * not get rather than a booking the diver does not get.
 */
export async function recordBuddyReferral(
  tx: DbExecutor,
  input: { shopId: string; bookingId: string; referredByBookingId: string },
): Promise<void> {
  await tx
    .insert(bookingReferrals)
    .values({
      shopId: input.shopId,
      bookingId: input.bookingId,
      referredByBookingId: input.referredByBookingId,
    })
    // One row per seat. A retried submit or a reactivated booking converges on
    // the first link that brought it rather than raising.
    .onConflictDoNothing({ target: bookingReferrals.bookingId });
}

/**
 * Seats this month that arrived on a diver's link — counted on the same basis
 * as every other figure on Reports: active bookings on this month's live
 * departures.
 */
export async function buddyReferredSeatsForWindow(
  db: DbExecutor,
  shopId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<number> {
  const [row] = await db
    .select({ seats: sql<number>`count(*)` })
    .from(bookingReferrals)
    .innerJoin(bookings, eq(bookings.id, bookingReferrals.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        liveTrip(),
        eq(bookingReferrals.shopId, shopId),
        sql`${trips.startsAt} >= ${windowStart} and ${trips.startsAt} < ${windowEnd}`,
        ne(bookings.status, "cancelled"),
      ),
    );
  return Number(row?.seats ?? 0);
}
