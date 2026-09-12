import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import {
  type NoShowGate,
  noShowGate,
  type SalvageOffer,
  SEAT_HELD_STATUSES,
  salvageOffer,
} from "@/lib/no-show";
import { similarDepartures } from "@/lib/similar-departures";
import { standingArrivalStatus } from "./arrival-provenance";
import { loadActiveStaffRoles } from "./authz";
import { tripCourseCrewCounts } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { onTheWaterByRollCall } from "./manifests";
import { activityEvents, bookings, courses, people, trips } from "./schema";
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
 * the reasoning, and ADR 20260911-the-confirm-tap-is-the-release records it).
 * Which makes the one thing this module must not do worth stating in a docblock
 * and then proving in a test rather than trusting a comment:
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
  | {
      ok: false;
      reason:
        | "not_found"
        | "staff_not_found"
        | "not_marked"
        | "trip_full"
        | "course_ratio_full"
        | "trip_cancelled";
    };

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
 *
 * **It writes nothing to the arrival trail, and that is the point** (issue
 * #1558). Missing the boat is not the desk taking back what it saw: a staffer
 * stood in front of this diver at 06:40 and tapped them in, and that happened
 * whatever the seat becomes afterwards. The trail is an append-only record of
 * sightings, so the only rows it takes are a new statement about who was seen
 * — and the retraction it *does* take is `undoCheckInBooking`'s, where the desk
 * is saying it was wrong about that. The standing `arrived` row left here is
 * what `undoBookingNoShow` below reads to put the seat back as `checked_in`
 * rather than `booked` (`standingArrivalStatus`, src/db/arrival-provenance.ts).
 *
 * It does **not** survive as a dive day. Until a `dive-domain-expert` review on
 * 2026-09-11 the two dive-day readers let that row outrank the status this
 * writes; the mark is later than the sighting and made by a person looking at
 * the empty space, so it is the newer statement and it wins
 * (`peopleWhoDivedBefore`, src/db/executed-dives.ts).
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

    const gate = noShowGate({
      bookingStatus: seat.status,
      // Read without a lock of its own, and correct only because the rail takes
      // the *booking* row `FOR UPDATE` too (`recordRollCall`, src/db/manifests.ts).
      // That is the shared object: while this transaction holds it, no roll
      // call can commit, so "the crew has not put them on the water" cannot go
      // stale between this line and the update below. Before that lock existed
      // the two shared no object at all and it could — `roll-call.postgres.test.ts`
      // races them for real and goes red the moment the lock is taken back out.
      //
      // Any checkpoint, and both of the crew's own statements that mean the
      // diver went to sea (`onTheWaterByRollCall`): one counted at the second
      // site has no departure event at all, and one recorded as not back after
      // a dive is a missing-diver row on the manifest rather than an absence.
      // Reading the dock's `boarded` alone left this refusal silent about
      // exactly the divers `inAfterDivePopulation` (src/db/today.ts) says are
      // at risk in the water. The dock's own `not_boarded` is the other
      // direction and stays eligible: there it means "never left".
      onTheWater: await onTheWaterByRollCall(tx, input.shopId, seat.tripId, seat.id),
      tripStatus: seat.tripStatus,
      startsAt: seat.startsAt,
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
 * it, and putting the first one back would overfill the boat. So the seat
 * count re-runs under the trip's own lock — the same `FOR UPDATE` on `trips`
 * that `restoreBooking` and `bookSpot` take — and a seat that is gone refuses
 * rather than quietly oversells.
 *
 * "Gone" means gone under **both** limits every seat-granting path applies, the
 * same pair `restoreBooking` checks and for the same reason: the trip's own
 * capacity, and on a ratio-gated course session the crew's seat cap
 * (`courseSeatCapacity`). Capacity alone left the tightest control in the
 * product one tap from being exceeded — mark a late participant not here on a
 * two-seat intro session, let a walk-up take the freed seat, then tap Undo as
 * they arrive at the dock, and a third uncertified first-timer joins one
 * instructor with no refusal anywhere.
 *
 * The trip's own state is read under that lock too, for the one condition that
 * makes an undo meaningless: **cancelled**. Nobody fails to show for a boat
 * that never left, so the mark is already refused there (`noShowGate`); the
 * undo answers the same way `restoreBooking` does, and reinstating the
 * departure is the recovery. No hold check and no departure-time check: an undo
 * is not a new booking, and the diver it puts back is the one standing at the
 * dock as the lines come off.
 *
 * The trail keeps both taps, and the tap that was refused. A correction is its
 * own line, never a deletion of the first one: "who released this seat, and did
 * they take it back?" is a question asked at a desk with a stranger standing at
 * it — and "somebody tried and the seat was gone" is the answer that question
 * most needs (`booking_no_show_undo_refused`, and the `refuse` helper below).
 *
 * **And the seat comes back as what it was**, which the arrival trail is the
 * only record of: a diver a staffer checked in at 06:40 and released at 07:10
 * is `checked_in` underneath, and the mark leaves that `arrived` row standing
 * on purpose (`standingArrivalStatus`, src/db/arrival-provenance.ts, is what
 * reads it back). Restoring every seat to `booked` put a diver who is standing
 * at the desk back on the counter's "still to come" list and asked a staffer to
 * check them in a second time with the diver in front of them
 * (`dive-domain-expert`, 2026-09-11).
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
      .select({
        id: trips.id,
        capacity: trips.capacity,
        status: trips.status,
        courseId: trips.courseId,
      })
      .from(trips)
      .where(and(eq(trips.id, seat.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1)
      .for("update");
    if (!trip) return { ok: false, reason: "not_found" };
    if (trip.status === "cancelled") return { ok: false, reason: "trip_cancelled" };

    // Counted under the lock, and counting only the seats somebody else holds:
    // this booking is `no_show` right now, so it is not in the total, and the
    // question is whether the boat has room for it back.
    const [held] = await tx
      .select({ booked: count(bookings.id) })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), inArray(bookings.status, [...SEAT_HELD_STATUSES])));
    const booked = held?.booked ?? 0;
    /**
     * **The two refusals that get a line of their own.**
     *
     * Every other one is either nothing happening (`not_marked` is a second
     * tap, `not_found` is a row this shop cannot see) or a fact already on the
     * board (`trip_cancelled`). These two are different: the seat is gone, a
     * staffer is standing at a desk with the diver in front of them, and until
     * this existed the shop's record of that morning ended at "somebody was
     * written off" — the mark was on the trail, the attempt to take it back was
     * not, and the person reconciling a full departure afterwards had no way to
     * learn that anyone had tried.
     *
     * The trail rather than the manifest, for the reason the mark is there:
     * the manifest answers "who is aboard", and nobody is. This is history,
     * and history is what the trail is for.
     */
    const refuse = async (
      reason: "trip_full" | "course_ratio_full",
    ): Promise<UndoNoShowOutcome> => {
      await tx.insert(activityEvents).values({
        shopId: input.shopId,
        tripId: seat.tripId,
        bookingId: seat.id,
        actorPersonId: recorder.id,
        code: "booking_no_show_undo_refused",
        params: { actor: recorder.name, diver: seat.personName, reason },
        occurredAt: now,
      });
      return { ok: false, reason };
    };
    if (booked >= trip.capacity) return await refuse("trip_full");

    if (trip.courseId) {
      const [course] = await tx
        .select()
        .from(courses)
        .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, input.shopId)))
        .limit(1);
      const { instructorCount, assistantCount } = await tripCourseCrewCounts(tx, trip.id);
      // Null means the session carries no ratio at all, so capacity alone binds.
      // A gated session that has since lost its last instructor caps at zero and
      // refuses too: a seat cannot be handed back to a session that could not
      // sell it in the first place.
      const seatCap = courseSeatCapacity(course ?? null, instructorCount, assistantCount);
      if (seatCap !== null && booked >= seatCap) return await refuse("course_ratio_full");
    }

    // The status the standing arrival supports, never an assumed one. Not a new
    // check-in and so no readiness re-read: this restores a statement the desk
    // already made, and boarding re-gates readiness of its own at the rail
    // (`recordRollCall`, src/db/manifests.ts). Both restored statuses hold a
    // seat (`SEAT_HELD_STATUSES`), so the two caps counted above bind either
    // way.
    const standing = await standingArrivalStatus(tx, input.shopId, seat.tripId, seat.id);
    const [updated] = await tx
      .update(bookings)
      .set({ status: standing === "arrived" ? "checked_in" : "booked" })
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
 * **What the shop can do once the seat comes free** — sell it to somebody
 * waiting, or give the diver who missed another day.
 *
 * Wait list first, a rebooking for that diver second, nothing third — the
 * precedence itself lives in `salvageOffer`, so the surface and this reader
 * can never disagree about which offer outranks which.
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

  // The storefront's own reader, with `hasSpace`, so a day offered at the
  // counter is one the diver who missed could actually be moved onto, and a
  // private charter is never offered. Bounded rather than paged for the reason
  // the public trip page gives: `similarDepartures` needs a pool, not a page.
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
