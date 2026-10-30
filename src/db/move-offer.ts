import { and, asc, eq, gt, isNull, lte, ne, notExists, sql } from "drizzle-orm";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { seatListPriceCents } from "@/lib/deposits";
import { isDiver, seatRefusal } from "@/lib/participant-types";
import { tripAdmissionFor, tripCourseCrewCounts } from "./bookings";
import type { AppDb } from "./client";
import { hasMoveAsk } from "./inbound-messages";
import { bookings, courses, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { heldSeatCounts, seatHeld, sellableCapacity, tripSellableSeatsSql } from "./trips-queries";

/**
 * **How many departures one cancelled card weighs**, soonest first. The card
 * renders on a GET with no throttle of its own (layer 4 security review, note
 * 1), and each candidate costs a few exact reads, so one SQL read narrows the
 * field and takes only this many: past the next few boats that could be
 * offered, the schedule link below covers the rest.
 */
export const MOVE_OFFER_CANDIDATES = 5;

export type MoveOffer = { tripId: string; title: string; startsAt: Date };

/**
 * **The one boat a called-off seat is offered** (UX sheet 2026-10-22, item 5;
 * H-151): the soonest departure of the same kind, at this shop, at the same
 * price or lower for this seat's type, with a seat free that this diver could
 * be sold today. Null when nothing qualifies, and the card stays as it was.
 *
 * **Advice, never a gate.** The diver's tap files an ordinary move ask
 * (`recordMoveAsk`); the desk moves the seat through `moveBooking`, which
 * re-reads every limit, the course's gates and admission under the trip lock.
 * What this read buys is that the card never names a boat that would be
 * refused on sight: full, pricier, private, already this diver's, or one the
 * booking-time card check would turn them away from.
 *
 * Only for a live seat on a departure the shop cancelled. Everything is read
 * from the booking at `shopId`, so a seat at another shop resolves nothing,
 * and the server action calls this again rather than trusting a trip id it
 * was posted.
 */
export async function strandedMoveOffer(
  db: AppDb,
  input: { shopId: string; bookingId: string; now: Date },
): Promise<MoveOffer | null> {
  const { shopId, bookingId, now } = input;
  const [seat] = await db
    .select({
      personId: bookings.personId,
      status: bookings.status,
      participantType: bookings.participantType,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      tripId: trips.id,
      tripStatus: trips.status,
      courseId: trips.courseId,
      priceCents: trips.priceCents,
      snorkelerPriceCents: trips.snorkelerPriceCents,
      riderPriceCents: trips.riderPriceCents,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId), liveTrip()))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (seat?.status !== "booked" || seat.tripStatus !== "cancelled") return null;
  // A held seat's link may be in someone else's hands (#2082); staff confirm
  // who it is before anything is offered on it.
  if (seat.identityUnconfirmedAt !== null) return null;

  const course = seat.courseId
    ? ((
        await db
          .select()
          .from(courses)
          .where(and(eq(courses.id, seat.courseId), eq(courses.shopId, shopId)))
          .limit(1)
      )[0] ?? null)
    : null;
  const paid = seatListPriceCents(seat, course, seat.participantType);
  // An unpriced seat has no "same price or lower" to measure against.
  if (paid === null) return null;

  // One read, soonest first, filtered in SQL so the cap counts only boats
  // that could be offered: scheduled, not held, not a rehearsal, not private,
  // not yet left, same course or another dive, not already this diver's,
  // fewer seats held than the departure's own capacity, and, where the
  // price is a plain column, priced no higher. The loop below re-checks each
  // one exactly (`seatListPriceCents`, the boat certificate, the divers-only
  // cap, the course ratio, admission), so this only ever narrows.
  const priceColumn = isDiver(seat.participantType)
    ? seat.courseId
      ? null
      : trips.priceCents
    : seat.participantType === "snorkeler"
      ? trips.snorkelerPriceCents
      : trips.riderPriceCents;
  const candidates = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        eq(trips.conditionsHold, false),
        eq(trips.isRehearsal, false),
        eq(trips.isPrivate, false),
        ne(trips.id, seat.tripId),
        gt(trips.startsAt, now),
        seat.courseId ? eq(trips.courseId, seat.courseId) : isNull(trips.courseId),
        priceColumn ? lte(priceColumn, paid) : undefined,
        notExists(
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(
                eq(bookings.shopId, shopId),
                eq(bookings.tripId, trips.id),
                eq(bookings.personId, seat.personId),
              ),
            ),
        ),
        sql`(select count(*) from ${bookings} where ${and(eq(bookings.tripId, trips.id), seatHeld)}) < ${tripSellableSeatsSql()}`,
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(MOVE_OFFER_CANDIDATES);

  for (const target of candidates) {
    const id = target.id;
    const price = seatListPriceCents(target, course, seat.participantType);
    if (price === null || price > paid) continue;
    const held = await heldSeatCounts(db, shopId, id);
    const capacity = await sellableCapacity(db, target);
    if (seatRefusal(seat.participantType, { ...target, capacity }, held)) continue;
    if (target.courseId && isDiver(seat.participantType)) {
      const { instructorCount, assistantCount } = await tripCourseCrewCounts(db, id);
      if (instructorCount === 0) continue;
      const seatCap = courseSeatCapacity(course, instructorCount, assistantCount);
      if (seatCap !== null && held.divers >= seatCap) continue;
    }
    const admission = await tripAdmissionFor(
      db,
      shopId,
      id,
      { id: seat.personId },
      false,
      Boolean(target.courseId),
      undefined,
      seat.participantType,
    );
    if (!admission.admitted) continue;
    return { tripId: id, title: target.title, startsAt: target.startsAt };
  }
  return null;
}

/**
 * What the cancelled card offers: the asked line once an ask stands (the
 * ordinary Ask to move, or this card's own), otherwise the boat to ask for.
 * Null leaves the card as it was.
 */
export type StrandedMoveAsk = { state: "asked" } | { state: "open"; offer: MoveOffer };

export async function strandedMoveAsk(
  db: AppDb,
  input: { shopId: string; bookingId: string; now: Date },
): Promise<StrandedMoveAsk | null> {
  if (await hasMoveAsk(db, input.shopId, input.bookingId, undefined, { calledOff: true })) {
    return { state: "asked" };
  }
  const found = await strandedMoveOffer(db, input);
  return found ? { state: "open", offer: found } : null;
}
