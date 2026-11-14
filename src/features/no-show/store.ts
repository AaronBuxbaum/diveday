import { and, eq, isNull } from "drizzle-orm";
import { liveTrip, pagedUpcomingTripsWithCounts, seatHeld } from "@/db/trips";
import { loadActiveStaffRoles } from "../../db/authz";
import {
  observationStanding,
  type RecordObservationOutcome,
  recordBoardingObservation,
  settleBoardingObservations,
} from "../../db/boarding-observations";
import { expirePendingCheckoutsForBooking } from "../../db/checkouts";
import type { AppDb, DbExecutor } from "../../db/client";
import { departureOpenToDiver } from "../../db/interest-offers";
import { listDepartureInterests } from "../../db/interests";
import { publishManifestEvent } from "../../db/manifest-events";
import { onTheWaterByRollCall } from "../../db/manifests";
import { activityEvents, bookings, people, trips } from "../../db/schema/index";
import { lockSeatDeparture } from "../../db/seat-locks";
import { shopHasFeatureOn } from "../../db/shops";
import { tripPrimarySiteId } from "../../db/trip-primary-site";

import { isStaff } from "../../lib/authz";
import type { BoardingObservationConflict } from "../../lib/boarding-observations";
import { nowDate } from "../../lib/clock";
import { seatName } from "../../lib/held-seat";
import { type NoShowGate, noShowGate, type SalvageOffer, salvageOffer } from "../../lib/no-show";
import { type SimilarDeparture, similarDepartures } from "../../lib/similar-departures";

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
  | {
      ok: true;
      bookingId: string;
      tripId: string;
      /** The seat is back (`applied`), or the observation is recorded and waiting (`pending`). */
      state: "applied" | "pending";
    }
  | {
      ok: true;
      bookingId: string;
      tripId: string;
      /** Recorded, and open: the departure cannot take the diver back yet, and says why. */
      state: "conflict";
      conflict: BoardingObservationConflict;
    }
  | Extract<RecordObservationOutcome, { ok: false }>;

/**
 * The person recording this is staff at this shop, right now.
 *
 * Same two-line shape `src/features/check-in/store.ts` uses for its own arrival writers:
 * `loadActiveStaffRoles` has already proven the person is this shop's, alive
 * and holding an active account, so `isStaff` is the only question left.
 */
export async function activeStaffRecorderId(
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
 * why the diver reads as checked in again once `undoBookingNoShow` below puts
 * the seat back, with nothing written about arrival (issue #2702).
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

    // The departure, then the seat (`lockSeatDeparture`).
    const tripId = await lockSeatDeparture(tx, input.shopId, input.bookingId);
    if (!tripId) return { ok: false, reason: "not_found" };
    const [seat] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        tripId: trips.id,
        tripStatus: trips.status,
        startsAt: trips.startsAt,
        fullName: people.fullName,
        identityUnconfirmedAt: bookings.identityUnconfirmedAt,
        identityBookedAs: bookings.identityBookedAs,
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
    // Another shop's booking id, or one whose departure has been taken off the
    // board, is simply not found — a staff surface must never learn that a row
    // it may not see exists.
    if (!seat) return { ok: false, reason: "not_found" };
    // The seat's name: on a held seat the one it was booked under, never the
    // matched person's (security review 2026-10-16, F1).
    const personName = seatName(seat.fullName, seat);

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
      // exactly the divers `inAfterDivePopulation` (src/features/today/today-reader.ts) says are
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
      .where(and(eq(bookings.id, seat.id), seatHeld))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "already_marked" };
    // The released seat is not the diver's to pay for any more (dde-3 #3).
    await expirePendingCheckoutsForBooking(tx, input.shopId, seat.id);

    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: seat.tripId,
      bookingId: seat.id,
      actorPersonId: recorder.id,
      code: "booking_no_show",
      params: { actor: recorder.name, diver: personName },
      occurredAt: now,
    });
    return { ok: true, bookingId: seat.id, tripId: seat.tripId, personName };
  });
  if (result.ok) await publishManifestEvent(db, input.shopId, result.tripId);
  return result;
}

/**
 * **"They're here": take the mark back**, for the diver who walks in as the
 * lines come off (issue #4474).
 *
 * The release was real, so by the time somebody taps the seat may have been
 * sold. It used to be one locked transaction that either put the seat back or
 * refused, and a refusal (or a lock wait behind a schedule write on the same
 * departure) left no record that the diver was standing at the dock. Now the
 * tap is an observation first (`recordBoardingObservation`): it commits without
 * waiting on the departure, idempotent by the form's own `clientKey`, and from
 * then on it holds the freed seat in every capacity count. The seat is then
 * allocated under the departure's lock (`settleBoardingObservations`), with a
 * one-second wait so the tap stays quick: `applied` puts the seat back as the
 * undo always did, `conflict` keeps the observation open with the reason (the
 * seat was sold, the course is full, the boat was called off) on the departure
 * and the board, and `pending` means the departure was busy and the retry after
 * the response or the shop tick will settle it.
 *
 * Both limits, the course gates and the cancelled and turned-away boundaries
 * are the ones the old undo asked (`observationPrecheck`, then the count);
 * nothing here grants a seat the old undo would have refused.
 */
export async function undoBookingNoShow(
  db: AppDb,
  input: {
    shopId: string;
    tripId?: string;
    bookingId: string;
    recordedByPersonId: string;
    clientKey?: string;
    now?: Date;
  },
): Promise<UndoNoShowOutcome> {
  const recorded = await recordBoardingObservation(db, input);
  if (!recorded.ok) return recorded;
  const settled = await settleBoardingObservations(db, {
    shopId: input.shopId,
    tripId: recorded.tripId,
    wait: "brief",
    now: input.now,
  });
  const base = { ok: true as const, bookingId: recorded.bookingId, tripId: recorded.tripId };
  if (!settled.ok) return { ...base, state: "pending" };
  const mine = settled.settled.find((row) => row.observationId === recorded.observationId);
  // Not in this pass: another pass holds the row (`SKIP LOCKED`) or already
  // settled it. Read where it stands rather than guess.
  if (!mine) {
    const standing = await observationStanding(db, input.shopId, recorded.observationId);
    if (standing?.state === "conflict" && standing.conflict) {
      return { ...base, state: "conflict", conflict: standing.conflict };
    }
    return { ...base, state: standing?.state === "applied" ? "applied" : "pending" };
  }
  if (mine.state === "conflict" && mine.conflict) {
    return { ...base, state: "conflict", conflict: mine.conflict };
  }
  return { ...base, state: "applied" };
}

/** Settle a departure's observations after the response, with the ordinary lock wait. */
export async function settleDockObservations(
  db: AppDb,
  input: { shopId: string; tripId: string },
): Promise<void> {
  await settleBoardingObservations(db, { ...input, wait: "bounded" });
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
  input: {
    shopId: string;
    tripId: string;
    /** The divers who missed: a day is offered to each only if they could book it. */
    personIds: string[];
    now?: Date;
  },
): Promise<Map<string, SalvageOffer>> {
  const now = input.now ?? nowDate();
  const offers = new Map<string, SalvageOffer>();
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) return offers;
  const offerEach = (offer: SalvageOffer) => {
    for (const personId of personIds) offers.set(personId, offer);
    return offers;
  };

  // **One read of the trip, its wait list and the board for every no-show**
  // (code review 2026-10-13, item 13): the desk used to run this whole chain
  // once per diver who missed, one after another. The wait list and the trip
  // go out together; the board only when nobody is waiting.
  // **A wait list switched off counts nobody** (the Features page; review
  // 2026-10-23, item 5): its offer could not be sent, so the desk is shown the
  // rebooking instead of a list it cannot use.
  const [waitlist, [trip]] = await Promise.all([
    shopHasFeatureOn(db, input.shopId, "waitlist").then((on) =>
      on ? listDepartureInterests(db, input.shopId, input.tripId) : [],
    ),
    db
      .select({ id: trips.id, courseId: trips.courseId, diveSiteId: tripPrimarySiteId })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1),
  ]);
  const waitlistCount = waitlist.filter(
    ({ interest }) => interest.askedBy === "diver" && !interest.offeredAt,
  ).length;
  if (waitlistCount > 0) return offerEach(salvageOffer({ waitlistCount, alternatives: [] }));
  if (!trip) return offerEach(salvageOffer({ waitlistCount: 0, alternatives: [] }));

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
  const similar = similarDepartures({
    full: { tripId: trip.id, courseId: trip.courseId, diveSiteId: trip.diveSiteId },
    candidates: board.trips.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      startsAt: candidate.startsAt,
      courseId: candidate.courseId,
      diveSiteId: candidate.diveSite?.id ?? null,
    })),
    limit: board.trips.length,
  });
  // Every similar day, ranked, then only those *this* diver could book from
  // the offer's link (`departureOpenToDiver`: a seat they already hold, a card
  // the day asks that they lack, a course at its ratio). Dive-domain review of
  // layer 8, F1: the panel promises the day is theirs to take. Each diver's
  // walk is their own, and the divers go side by side.
  //
  // **A few days at a time, not one** (code review 2026-10-13b, item 36): each
  // diver's walk asked one candidate, waited, then asked the next, over up to
  // fifty. Now it asks the next `SALVAGE_STEP` together and keeps the passes
  // in rank order, so the days offered are exactly the ones the one-at-a-time
  // walk would have found, usually in one round instead of several. The bound
  // is per diver: `SALVAGE_STEP` questions in flight for each, with the divers
  // themselves side by side.
  await Promise.all(
    personIds.map(async (personId) => {
      const alternatives: SimilarDeparture[] = [];
      for (
        let start = 0;
        start < similar.length && alternatives.length < SALVAGE_DAYS;
        start += SALVAGE_STEP
      ) {
        const step = similar.slice(start, start + SALVAGE_STEP);
        const open = await Promise.all(
          step.map((departure) =>
            departureOpenToDiver(db, {
              shopId: input.shopId,
              tripId: departure.tripId,
              personId,
              now,
            }),
          ),
        );
        for (const [index, departure] of step.entries()) {
          if (open[index] && alternatives.length < SALVAGE_DAYS) alternatives.push(departure);
        }
      }
      offers.set(personId, salvageOffer({ waitlistCount: 0, alternatives }));
    }),
  );
  return offers;
}

/** As many days as `similarDepartures` offers by default, for the same reason. */
const SALVAGE_DAYS = 2;

/** Candidates asked together in a diver's salvage walk: twice the days it keeps. */
const SALVAGE_STEP = 4;
