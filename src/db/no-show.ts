import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import {
  type NoShowGate,
  noShowGate,
  type SalvageOffer,
  SEAT_HELD_STATUSES,
  salvageOffer,
} from "@/lib/no-show";
import { similarDepartures } from "@/lib/similar-departures";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { departureRollCallForBooking } from "./manifests";
import { activityEvents, bookings, people, shops, trips } from "./schema";
import { getTripWaitlist, pagedUpcomingTripsWithCounts } from "./trips";
import { liveTrip } from "./trips-live";

/**
 * **The first writer of `bookings.status = "no_show"`** (issue #1209).
 *
 * The value has existed in the enum since the beginning and a dozen readers
 * branch on it — `ready.ts`, `recap.ts`, `tips.ts`, `closeout.ts` — every one
 * of them dead, because no action in the product ever wrote one. This module is
 * that action's data layer.
 *
 * **The staffer's confirm tap is the seat release.** There is no
 * `seat_released_at` column and no second tap: the mark is the human act, and
 * the seat becoming sellable is its consequence (`src/lib/no-show.ts` carries
 * the reasoning, and `docs/product/features/roadmap.md` specifies it). Which
 * makes the one thing this module must not do worth stating in a docblock and
 * then proving in a test rather than trusting a comment:
 *
 * **It touches no money.** Not an order, not a payment, not a refund, not a
 * checkout, not a line item. A diver who missed a boat may be owed a refund,
 * may owe the shop the fare, or may be a regular the owner waves through, and
 * which of those it is is a decision a person makes on the shop's own terms.
 * The counter's job is to say the seat is free; the money stays where every
 * other money decision in this product lives — with a human, on the order.
 */

/**
 * Why the mark was refused, or that it landed. Every gate code but `eligible`
 * is a refusal a staffer can be told about, plus the two this layer adds: a
 * booking this shop cannot see, and a recorder who is not its staff.
 */
export type MarkNoShowOutcome =
  | { ok: true; bookingId: string; tripId: string; personName: string }
  | { ok: false; reason: Exclude<NoShowGate, "eligible"> | "not_found" | "staff_not_found" };

export type UndoNoShowOutcome =
  | { ok: true; bookingId: string; tripId: string; personName: string }
  | { ok: false; reason: "not_found" | "staff_not_found" | "not_marked" | "trip_full" };

/**
 * The person recording this is staff at this shop, right now.
 *
 * Same two-line shape `src/db/check-in.ts` uses for its own arrival writers:
 * `loadActiveStaffRoles` has already proven the person is this shop's, alive
 * and holding an active account, so `isStaff` is the only question left.
 */
async function activeStaffRecorderId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<{ id: string; name: string } | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  if (!roles || !isStaff(roles)) return null;
  const [row] = await tx
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .limit(1);
  return row ? { id: personId, name: row.name } : null;
}

/**
 * **Record that a diver never turned up, and free their seat.**
 *
 * The gate runs twice: once on the surface, to decide whether the door is
 * drawn at all, and once here against rows read under `FOR UPDATE`. The second
 * run is the one that counts — between a staffer looking at the row and
 * tapping it, the crew can record that diver aboard, another device can mark
 * the same seat, or the weather can call the day off, and a door drawn ten
 * seconds ago is not evidence of anything.
 *
 * `publishManifestEvent` fires after the transaction commits, because a seat
 * leaving the expected list is the change most likely to land while a captain
 * is already walking to the boat with a phone in their hand.
 */
export async function markBookingNoShow(
  db: AppDb,
  input: { shopId: string; bookingId: string; recordedByPersonId: string; now?: Date },
): Promise<MarkNoShowOutcome> {
  const now = input.now ?? nowDate();
  const result = await db.transaction(async (tx): Promise<MarkNoShowOutcome> => {
    const recorder = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!recorder) return { ok: false, reason: "staff_not_found" };

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
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
    // Another shop's booking id, or one whose departure has been taken off the
    // board, is simply not found — a staff surface must never learn that a row
    // it may not see exists.
    if (!seat) return { ok: false, reason: "not_found" };

    // The shop's own arrival call opens the window. Read outside the lock
    // above on purpose: locking the shop row to mark one diver absent would
    // serialise every counter in the building behind it.
    const [shop] = await tx
      .select({ dockCallMinutes: shops.dockCallMinutes })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .limit(1);
    if (!shop) return { ok: false, reason: "not_found" };

    const gate = noShowGate({
      bookingStatus: seat.status,
      boarded:
        (await departureRollCallForBooking(tx, input.shopId, seat.tripId, seat.id)) === "boarded",
      tripStatus: seat.tripStatus,
      startsAt: seat.startsAt,
      dockCallMinutes: shop.dockCallMinutes,
      now,
    });
    if (gate !== "eligible") return { ok: false, reason: gate };

    const [updated] = await tx
      .update(bookings)
      .set({ status: "no_show" })
      .where(and(eq(bookings.id, seat.id), inArray(bookings.status, [...SEAT_HELD_STATUSES])))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "already_marked" };

    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: seat.tripId,
      bookingId: seat.id,
      actorPersonId: recorder.id,
      code: "booking_no_show",
      params: { actor: recorder.name, diver: seat.personName },
      occurredAt: now,
    });
    return { ok: true, bookingId: seat.id, tripId: seat.tripId, personName: seat.personName };
  });
  if (result.ok) await publishManifestEvent(db, input.shopId, result.tripId);
  return result;
}

/**
 * **Take the mark back**, for the diver who walks in as the lines come off.
 *
 * Not a plain status flip, because the release was real: by the time somebody
 * taps Undo the shop may have sold the seat to the diver who was waiting for
 * it, and putting the first one back would overfill the boat. So the capacity
 * count re-runs under the trip's own lock — the same `FOR UPDATE` on `trips`
 * that `restoreBooking` and `bookSpot` take — and a resold seat refuses with
 * `trip_full` rather than quietly oversells.
 *
 * The trail keeps both taps. A correction is its own line, never a deletion of
 * the first one: "who released this seat, and did they take it back?" is a
 * question asked at a desk with a stranger standing at it.
 */
export async function undoBookingNoShow(
  db: AppDb,
  input: { shopId: string; bookingId: string; recordedByPersonId: string; now?: Date },
): Promise<UndoNoShowOutcome> {
  const now = input.now ?? nowDate();
  const result = await db.transaction(async (tx): Promise<UndoNoShowOutcome> => {
    const recorder = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!recorder) return { ok: false, reason: "staff_not_found" };

    const [seat] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        tripId: bookings.tripId,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!seat) return { ok: false, reason: "not_found" };
    if (seat.status !== "no_show") return { ok: false, reason: "not_marked" };

    const [trip] = await tx
      .select({ id: trips.id, capacity: trips.capacity })
      .from(trips)
      .where(and(eq(trips.id, seat.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return { ok: false, reason: "not_found" };

    // Counted under the lock, and counting only the seats somebody else holds:
    // this booking is `no_show` right now, so it is not in the total, and the
    // question is whether the boat has room for it back.
    const [held] = await tx
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), inArray(bookings.status, [...SEAT_HELD_STATUSES])));
    if ((held?.booked ?? 0) >= trip.capacity) return { ok: false, reason: "trip_full" };

    const [updated] = await tx
      .update(bookings)
      .set({ status: "booked" })
      .where(and(eq(bookings.id, seat.id), eq(bookings.status, "no_show")))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "not_marked" };

    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: seat.tripId,
      bookingId: seat.id,
      actorPersonId: recorder.id,
      code: "booking_no_show_undone",
      params: { actor: recorder.name, diver: seat.personName },
      occurredAt: now,
    });
    return { ok: true, bookingId: seat.id, tripId: seat.tripId, personName: seat.personName };
  });
  if (result.ok) await publishManifestEvent(db, input.shopId, result.tripId);
  return result;
}

/**
 * **What the shop can do with the seat that just came free.**
 *
 * Wait list first, a similar departure second, nothing third — the precedence
 * itself lives in `salvageOffer`, so the surface and this reader can never
 * disagree about which offer outranks which.
 *
 * Wait-list entries already invited are filtered out here rather than counted
 * and struck through: the count is what a staffer reads in one glance while
 * somebody waits at the desk, and a number that includes people already
 * chased is a number that sends two staff after the same diver.
 *
 * The board read is skipped entirely when there is a wait list, because on
 * that path it is a query nobody asked for — the same reason the public trip
 * page reads its own board only for a full boat.
 */
export async function noShowSalvage(
  db: AppDb,
  input: { shopId: string; tripId: string; now?: Date },
): Promise<SalvageOffer> {
  const now = input.now ?? nowDate();
  const waitlist = await getTripWaitlist(db, input.shopId, input.tripId);
  const waitlistCount = waitlist.filter((row) => !row.entry.invitedAt).length;
  if (waitlistCount > 0) return salvageOffer({ waitlistCount, alternatives: [] });

  const [trip] = await db
    .select({ id: trips.id, courseId: trips.courseId, diveSiteId: trips.diveSiteId })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!trip) return salvageOffer({ waitlistCount: 0, alternatives: [] });

  // The storefront's own reader, with `hasSpace`, so an alternative offered at
  // the counter is one a diver could actually be moved onto, and a private
  // charter is never offered. Bounded rather than paged for the reason the
  // public trip page gives: `similarDepartures` needs a pool, not a page.
  const board = await pagedUpcomingTripsWithCounts(db, input.shopId, {
    now,
    limit: 50,
    hasSpace: true,
    publicOnly: true,
  });
  return salvageOffer({
    waitlistCount: 0,
    alternatives: similarDepartures({
      full: { tripId: trip.id, courseId: trip.courseId, diveSiteId: trip.diveSiteId },
      candidates: board.trips.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        startsAt: candidate.startsAt,
        courseId: candidate.courseId,
        diveSiteId: candidate.diveSiteId,
      })),
    }),
  });
}
