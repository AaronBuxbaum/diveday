import { and, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, dateRequestOfferBookings, interests } from "./schema";
import { seatHeld } from "./trips-queries";

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
 * Seats on an offer held by an active booking. `excludeBookingId` leaves out the booking being
 * seated or associated, so it never counts against itself. Run under the request and offer locks.
 */
async function activeLinkedSeats(
  tx: DbExecutor,
  input: { shopId: string; offerId: string; excludeBookingId?: string },
): Promise<number> {
  const [linked] = await tx
    .select({ seats: count(bookings.id) })
    .from(dateRequestOfferBookings)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, dateRequestOfferBookings.bookingId),
        eq(bookings.shopId, input.shopId),
        seatHeld,
      ),
    )
    .where(
      and(
        eq(dateRequestOfferBookings.shopId, input.shopId),
        eq(dateRequestOfferBookings.interestId, input.offerId),
        ...(input.excludeBookingId
          ? [ne(dateRequestOfferBookings.bookingId, input.excludeBookingId)]
          : []),
      ),
    );
  return linked?.seats ?? 0;
}

/**
 * Lock the request before its offer child. This is the common serialization
 * point for every offered departure and matches erasure's parent-then-child
 * order. Booking creation also holds its departure lock first; association-only
 * calls never take a trip lock.
 */
export async function lockDateRequestOffer(
  tx: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    requestId: string;
    excludeBookingId?: string;
    /**
     * A new link to the request: a closed request takes none, so a stale form
     * cannot seat someone against a request the band already calls gone. A seat
     * already linked (restored, moved, re-seated) keeps its closed request.
     */
    newLink?: boolean;
  },
): Promise<{ offerId: string; requestId: string; partySize: number } | DateRequestBookingRefusal> {
  const [request] = await tx
    .select({ id: interests.id, closedAt: interests.closedAt })
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
        seatHeld,
        ne(bookings.tripId, input.tripId),
        ...(input.excludeBookingId ? [ne(bookings.id, input.excludeBookingId)] : []),
      ),
    )
    .limit(1);
  if (conflict) return "date_request_departure_conflict";
  const linked = await activeLinkedSeats(tx, {
    shopId: input.shopId,
    offerId: offer.id,
    excludeBookingId: input.excludeBookingId,
  });
  if (linked >= (offer.partySize ?? 1)) return "date_request_party_full";
  // After the party check, so a seat past a completed party still reads as
  // the party being full rather than the request being gone.
  if (input.newLink && request.closedAt) return "date_request_offer_unavailable";
  return { offerId: offer.id, requestId: request.id, partySize: offer.partySize ?? 1 };
}

/** Close a requested party only after all offered seats have active bookings. */
export async function completeDateRequestOfferParty(
  tx: DbExecutor,
  input: { shopId: string; requestId: string; offerId: string; partySize: number; now: Date },
): Promise<boolean> {
  const linked = await activeLinkedSeats(tx, { shopId: input.shopId, offerId: input.offerId });
  if (linked < input.partySize) return false;

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

  const linked = await activeLinkedSeats(tx, {
    shopId: input.shopId,
    offerId: input.offerId,
    excludeBookingId: input.bookingId,
  });
  if (linked >= input.partySize) return false;

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

/**
 * How far a request's party is seated on one offered departure, for the
 * departure's add band: the seats held by active bookings, out of the offer's
 * party. Null when the request was never offered this departure. A read only;
 * the seat itself counts again under the locks (`lockDateRequestOffer`).
 */
export async function dateRequestPartyOnDeparture(
  db: DbExecutor,
  input: { shopId: string; tripId: string; requestId: string },
): Promise<{ seated: number; partySize: number } | null> {
  const [offer] = await db
    .select({ id: interests.id, partySize: interests.partySize })
    .from(interests)
    .where(
      and(
        eq(interests.shopId, input.shopId),
        eq(interests.scope, "departure"),
        eq(interests.tripId, input.tripId),
        eq(interests.parentInterestId, input.requestId),
        isNotNull(interests.offeredAt),
      ),
    )
    .limit(1);
  if (!offer) return null;
  const seated = await activeLinkedSeats(db, { shopId: input.shopId, offerId: offer.id });
  return { seated, partySize: offer.partySize ?? 1 };
}
