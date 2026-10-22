import { and, eq, inArray } from "drizzle-orm";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { seatListPriceCents } from "@/lib/deposits";
import { isDiver, seatRefusal } from "@/lib/participant-types";
import { listSeatMoveTargets, tripAdmissionFor, tripCourseCrewCounts } from "./bookings";
import type { AppDb } from "./client";
import { hasMoveAsk } from "./inbound-messages";
import { bookings, courses, trips } from "./schema";
import { liveTrip } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";

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

  // Scheduled, not held, not a rehearsal, not yet left, same course or
  // another dive: the roster's own move list, soonest first.
  const targets = await listSeatMoveTargets(db, shopId, seat.tripId, now);
  const open = targets.filter((target) => target.seatsLeft > 0);
  if (open.length === 0) return null;
  const rows = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        inArray(
          trips.id,
          open.map((target) => target.id),
        ),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const mine = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, seat.personId),
        inArray(
          bookings.tripId,
          open.map((target) => target.id),
        ),
      ),
    );
  const alreadyMine = new Set(mine.map((row) => row.tripId));

  for (const { id } of open) {
    const target = byId.get(id);
    if (!target || target.isPrivate || alreadyMine.has(id)) continue;
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
  if (await hasMoveAsk(db, input.shopId, input.bookingId)) return { state: "asked" };
  const found = await strandedMoveOffer(db, input);
  return found ? { state: "open", offer: found } : null;
}
