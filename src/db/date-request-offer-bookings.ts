import { and, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import type { DbExecutor } from "./client";
import { bookings, dateRequestOfferBookings, interests } from "./schema";

export type DateRequestBookingRefusal =
  | "date_request_offer_unavailable"
  | "date_request_departure_conflict"
  | "date_request_party_full";

/** Read the offered departure linked to one booking without exposing interests to booking code. */
export async function dateRequestOfferBookingFor(
  tx: DbExecutor,
  input: { shopId: string; bookingId: string },
) {
  const [link] = await tx
    .select({
      offerId: interests.id,
      tripId: interests.tripId,
      requestId: interests.parentInterestId,
      scope: interests.scope,
    })
    .from(dateRequestOfferBookings)
    .innerJoin(
      interests,
      and(
        eq(interests.id, dateRequestOfferBookings.interestId),
        eq(interests.shopId, input.shopId),
      ),
    )
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(dateRequestOfferBookings.bookingId, input.bookingId),
      ),
    )
    .limit(1);
  return link;
}

/**
 * Lock the request before its offer child. This is the common serialization
 * point for every offered departure and matches erasure's parent-then-child
 * order. Booking creation also holds its departure lock first; association-only
 * calls never take a trip lock.
 */
export async function lockDateRequestOffer(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; requestId: string; excludeBookingId?: string },
): Promise<{ offerId: string; requestId: string; partySize: number } | DateRequestBookingRefusal> {
  const [request] = await tx
    .select({ id: interests.id })
    .from(interests)
    .where(
      and(
        eq(interests.id, input.requestId),
        eq(interests.shopId, input.shopId),
        eq(interests.scope, "date"),
      ),
    )
    .limit(1)
    .for("no key update", { of: interests });
  if (!request) return "date_request_offer_unavailable";

  const [offer] = await tx
    .select({ id: interests.id, partySize: interests.partySize })
    .from(interests)
    .where(
      and(
        eq(interests.shopId, input.shopId),
        eq(interests.scope, "departure"),
        eq(interests.tripId, input.tripId),
        eq(interests.parentInterestId, request.id),
        isNotNull(interests.offeredAt),
      ),
    )
    .limit(1)
    .for("update", { of: interests });
  if (!offer) return "date_request_offer_unavailable";

  // The active party pins the request to its departure. Once every linked
  // seat is released, the request can be explicitly booked on another offer;
  // the historical associations remain so reactivation can still be checked
  // against whichever active party exists then.
  const [conflict] = await tx
    .select({ id: bookings.id })
    .from(dateRequestOfferBookings)
    .innerJoin(
      interests,
      and(
        eq(interests.id, dateRequestOfferBookings.interestId),
        eq(interests.shopId, input.shopId),
      ),
    )
    .innerJoin(
      bookings,
      and(eq(bookings.id, dateRequestOfferBookings.bookingId), eq(bookings.shopId, input.shopId)),
    )
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(interests.parentInterestId, request.id),
        eq(interests.scope, "departure"),
        inArray(bookings.status, [...SEAT_HELD_STATUSES]),
        ne(bookings.tripId, input.tripId),
        ...(input.excludeBookingId ? [ne(bookings.id, input.excludeBookingId)] : []),
      ),
    )
    .limit(1);
  if (conflict) return "date_request_departure_conflict";
  const [linked] = await tx
    .select({ seats: count(bookings.id) })
    .from(dateRequestOfferBookings)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, dateRequestOfferBookings.bookingId),
        eq(bookings.shopId, input.shopId),
        inArray(bookings.status, [...SEAT_HELD_STATUSES]),
      ),
    )
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(dateRequestOfferBookings.interestId, offer.id),
        ...(input.excludeBookingId
          ? [ne(dateRequestOfferBookings.bookingId, input.excludeBookingId)]
          : []),
      ),
    );
  if ((linked?.seats ?? 0) >= (offer.partySize ?? 1)) return "date_request_party_full";
  return { offerId: offer.id, requestId: request.id, partySize: offer.partySize ?? 1 };
}

/** Close a requested party only after all offered seats have active bookings. */
export async function completeDateRequestOfferParty(
  tx: DbExecutor,
  input: { shopId: string; requestId: string; offerId: string; partySize: number; now: Date },
): Promise<boolean> {
  const [linked] = await tx
    .select({ seats: count(bookings.id) })
    .from(dateRequestOfferBookings)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, dateRequestOfferBookings.bookingId),
        eq(bookings.shopId, input.shopId),
        inArray(bookings.status, [...SEAT_HELD_STATUSES]),
      ),
    )
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(dateRequestOfferBookings.interestId, input.offerId),
      ),
    );
  if ((linked?.seats ?? 0) < input.partySize) return false;

  // The request lock is already held by lockDateRequestOffer. Preserve a
  // staff-entered close reason; booking only supplies the first answer.
  await tx
    .update(interests)
    .set({ closedAt: input.now, closedAs: "booked" })
    .where(
      and(
        eq(interests.id, input.requestId),
        eq(interests.shopId, input.shopId),
        eq(interests.scope, "date"),
        isNull(interests.closedAt),
      ),
    );
  return true;
}

/** Record the booking under the already-held request and offer locks. */
export async function recordDateRequestOfferBooking(
  tx: DbExecutor,
  input: { shopId: string; offerId: string; bookingId: string; partySize: number },
): Promise<boolean> {
  const [existing] = await tx
    .select({ interestId: dateRequestOfferBookings.interestId })
    .from(dateRequestOfferBookings)
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(dateRequestOfferBookings.bookingId, input.bookingId),
      ),
    )
    .limit(1);
  if (existing?.interestId === input.offerId) return true;
  if (existing) return false;

  const [linked] = await tx
    .select({ seats: count(bookings.id) })
    .from(dateRequestOfferBookings)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, dateRequestOfferBookings.bookingId),
        eq(bookings.shopId, input.shopId),
        inArray(bookings.status, [...SEAT_HELD_STATUSES]),
      ),
    )
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(dateRequestOfferBookings.interestId, input.offerId),
        ne(dateRequestOfferBookings.bookingId, input.bookingId),
      ),
    );
  if ((linked?.seats ?? 0) >= input.partySize) return false;

  const [inserted] = await tx
    .insert(dateRequestOfferBookings)
    .values({ shopId: input.shopId, interestId: input.offerId, bookingId: input.bookingId })
    .onConflictDoNothing()
    .returning({ bookingId: dateRequestOfferBookings.bookingId });
  return inserted !== undefined;
}

/** Repoint one moved booking after its request and target offer are locked. */
export async function moveDateRequestOfferBooking(
  tx: DbExecutor,
  input: { shopId: string; bookingId: string; fromOfferId: string; toOfferId: string },
): Promise<boolean> {
  const [updated] = await tx
    .update(dateRequestOfferBookings)
    .set({ interestId: input.toOfferId })
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(dateRequestOfferBookings.bookingId, input.bookingId),
        eq(dateRequestOfferBookings.interestId, input.fromOfferId),
      ),
    )
    .returning({ bookingId: dateRequestOfferBookings.bookingId });
  return updated !== undefined;
}
