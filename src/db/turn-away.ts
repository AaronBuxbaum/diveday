import { and, eq, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { type TurnAwayGate, type TurnAwayReason, turnAwayGate } from "@/lib/turn-away";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { onTheWaterByRollCall } from "./manifests";
import { activeStaffRecorderId } from "./no-show";
import { getBookingReadiness } from "./readiness";
import { activityEvents, bookings, people, trips } from "./schema";
import { lockSeatDeparture } from "./seat-locks";
import { liveTrip } from "./trips-live";

/**
 * **"Turned away" at the desk** (safety sheet 2026-10-15, item 6; H-124): the
 * diver was seen, readiness would not board them, and the desk sent them home.
 *
 * The seat is released exactly as `markBookingNoShow` releases it
 * (src/db/no-show.ts): `bookings.status = "no_show"`, so every capacity count,
 * recap, tip, review invitation and dive-day count that leaves a no-show out
 * leaves this diver out too, and "Put back on the list" (`undoBookingNoShow`)
 * takes it back. What differs is the record: `turned_away_reason` says the desk
 * saw them and why, and the trail line says it in those words, so nobody reads
 * "did not arrive" about a person the desk stood in front of.
 *
 * **It touches no money**, for the reason `markBookingNoShow` does not: whether
 * the fare is moved, refunded or kept is a person's decision on the order. The
 * counter links to it.
 *
 * **It writes nothing to the arrival trail.** A turned-away diver was not
 * checked in, and the trail records check-ins.
 */
export type TurnAwayOutcome =
  | { ok: true; bookingId: string; tripId: string; personName: string; reason: TurnAwayReason }
  | {
      ok: false;
      reason: Exclude<TurnAwayGate, "eligible"> | "not_found" | "staff_not_found";
    };

/**
 * Record that the desk turned this diver away for `reason`, and free the seat.
 *
 * The gate runs against rows read under the seat's lock, and readiness is
 * re-read inside the same transaction: a door drawn on a blocked row ten
 * seconds ago is not evidence that the row is still blocked, or blocked for
 * that reason. A stale reason is refused, never rewritten.
 */
export async function turnBookingAway(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    reason: TurnAwayReason;
    recordedByPersonId: string;
    now?: Date;
  },
): Promise<TurnAwayOutcome> {
  const now = input.now ?? nowDate();
  const result = await db.transaction(async (tx): Promise<TurnAwayOutcome> => {
    // Any active staff member (H-124); a diver, a former staffer or another
    // shop's person is refused before anything is read.
    const recorder = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!recorder) return { ok: false, reason: "staff_not_found" };

    // The departure, then the seat (`lockSeatDeparture`, #2324's order).
    const tripId = await lockSeatDeparture(tx, input.shopId, input.bookingId);
    if (!tripId) return { ok: false, reason: "not_found" };
    const [seat] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        tripId: trips.id,
        tripStatus: trips.status,
        startsAt: trips.startsAt,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), liveTrip()))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, tripId),
        ),
      )
      .limit(1)
      .for("update", { of: [bookings, people] });
    // Another shop's booking is simply not found: a staff surface must never
    // learn that a row it may not see exists.
    if (!seat) return { ok: false, reason: "not_found" };

    const readiness = await getBookingReadiness(tx as DbExecutor, input.shopId, seat.id);
    const gate = turnAwayGate({
      bookingStatus: seat.status,
      // Correct under the booking's `FOR UPDATE` for the reason
      // `markBookingNoShow` gives: the rail takes the same lock.
      onTheWater: await onTheWaterByRollCall(tx, input.shopId, seat.tripId, seat.id),
      tripStatus: seat.tripStatus,
      startsAt: seat.startsAt,
      now,
      // A lookup that found nothing fails closed: no blocker gives no reason.
      readiness: readiness ?? { status: "blocked", blockers: [{ code: "readiness_unavailable" }] },
      reason: input.reason,
    });
    if (gate !== "eligible") return { ok: false, reason: gate };

    // The seat is freed once: the status guard makes a second tap, or a
    // no-show landing first, update nothing.
    const [updated] = await tx
      .update(bookings)
      .set({ status: "no_show", turnedAwayReason: input.reason })
      .where(and(eq(bookings.id, seat.id), inArray(bookings.status, [...SEAT_HELD_STATUSES])))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "already_marked" };

    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: seat.tripId,
      bookingId: seat.id,
      actorPersonId: recorder.id,
      code: "booking_turned_away",
      params: { actor: recorder.name, diver: seat.personName, reason: input.reason },
      occurredAt: now,
    });
    return {
      ok: true,
      bookingId: seat.id,
      tripId: seat.tripId,
      personName: seat.personName,
      reason: input.reason,
    };
  });
  // A seat leaving the expected list is news for the crew walking to the boat.
  if (result.ok) await publishManifestEvent(db, input.shopId, result.tripId);
  return result;
}
