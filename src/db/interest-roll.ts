import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nowDate } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS, hasSailed } from "@/lib/trips";
import type { AppDb } from "./client";
import { deliverSeatOffer, invitableSeats } from "./interest-offers";
import { bookings, interests, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **The wait list rolls forward** (third UX review, item 12). A wait list is a
 * set of interests the shop works (ADR 20260813-wait-list-is-a-lead-list); when the
 * departure they waited for fills and sails, or a second departure is put up
 * for them, the interests should not stay behind on a day that is gone or full.
 *
 * Both helpers **copy** departure interests the diver asked for rather than move
 * them: the original row is the record of what the diver asked for
 * (`parent_interest_id` points back at it), and the unique (trip, person) index
 * makes a second run a no-op. A copy keeps the time the diver first asked, so
 * the list reads in the order people actually waited. Nobody already holding a
 * seat on the target is added. Nothing here ranks anyone: every interest travels.
 * A cold invitation (`asked_by = 'shop'`) was the shop's outreach for that
 * date, and stays there.
 *
 * **A date request attached to a departure is not a wait list** (dive-domain
 * review of #2656, M1). The builder's child of a `date` interest was a contact the
 * shop chose to work by hand on the date it built; on main a `trip_invitations`
 * row never rolled and was never auto-invited. It neither travels nor is
 * invited by the roll: nothing checked that the asker fits the next date, and
 * the roll's mail would tell them a date they never chose filled.
 */

const requestParent = alias(interests, "request_parent");

/** The departure row is not the child of a diver's date request. */
function notADateRequest(db: AppDb) {
  return notExists(
    db
      .select({ id: requestParent.id })
      .from(requestParent)
      .where(
        and(eq(requestParent.id, interests.parentInterestId), eq(requestParent.scope, "date")),
      ),
  );
}

/** Copy one departure's waiting interests onto another of this shop's. Returns the new interests. */
async function copyInterests(
  db: AppDb,
  input: { shopId: string; fromTripId: string; toTripId: string; uninvitedOnly: boolean },
): Promise<string[]> {
  const waiting = await db
    .select({
      id: interests.id,
      personId: interests.personId,
      askedAt: interests.askedAt,
      partySize: interests.partySize,
    })
    .from(interests)
    .where(
      and(
        eq(interests.shopId, input.shopId),
        eq(interests.scope, "departure"),
        eq(interests.tripId, input.fromTripId),
        eq(interests.askedBy, "diver"),
        isNotNull(interests.personId),
        notADateRequest(db),
        input.uninvitedOnly ? isNull(interests.offeredAt) : undefined,
      ),
    )
    .orderBy(asc(interests.askedAt));
  if (waiting.length === 0) return [];
  const seated = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.toTripId),
        ne(bookings.status, "cancelled"),
        inArray(
          bookings.personId,
          waiting.flatMap((interest) => (interest.personId ? [interest.personId] : [])),
        ),
      ),
    );
  const onBoard = new Set(seated.map((row) => row.personId));
  const fresh = waiting.filter((interest) => !interest.personId || !onBoard.has(interest.personId));
  if (fresh.length === 0) return [];
  const inserted = await db
    .insert(interests)
    .values(
      fresh.map((interest) => ({
        shopId: input.shopId,
        scope: "departure" as const,
        askedBy: "diver" as const,
        tripId: input.toTripId,
        personId: interest.personId,
        parentInterestId: interest.id,
        askedAt: interest.askedAt,
        // A party travels whole (ADR 20260719-trip-waitlist, amended).
        partySize: interest.partySize,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: interests.id });
  return inserted.map((row) => row.id);
}

/**
 * A departure of this shop that still takes a seat, short of the clock and
 * beside `liveTrip()`: scheduled, not a rehearsal, and not on a conditions
 * hold, which refuses every new seat (`tripTakesSeatFrom` in `./bookings.ts`).
 */
function takesSeats(shopId: string) {
  return and(
    eq(trips.shopId, shopId),
    notRehearsal(),
    eq(trips.status, "scheduled"),
    eq(trips.conditionsHold, false),
  );
}

/** One of this shop's departures that takes a seat and has not left. */
async function openDeparture(db: AppDb, shopId: string, tripId: string, now: Date) {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), liveTrip(), takesSeats(shopId)))
    .limit(1);
  return trip && !hasSailed(trip.startsAt, now) ? trip : null;
}

/** A person on this departure with a seat that is not cancelled. */
function seatedOn(tripId: string) {
  return and(
    eq(bookings.tripId, tripId),
    eq(bookings.personId, interests.personId),
    ne(bookings.status, "cancelled"),
  );
}

export type CarryInterestsOutcome =
  | { ok: true; carried: number }
  | { ok: false; reason: "not_found" | "target_unavailable" };

/**
 * **"Carry the wait list" from the demand banner.** A full departure whose
 * interests are still waiting hands every one of them to another departure the
 * shop has put up, where the wait list's one-tap invite reaches them. Staff
 * choose the departure, and nobody is messaged until staff invite.
 */
export async function carryInterests(
  db: AppDb,
  input: { shopId: string; fromTripId: string; toTripId: string; now?: Date },
): Promise<CarryInterestsOutcome> {
  const now = input.now ?? nowDate();
  if (input.fromTripId === input.toTripId) return { ok: false, reason: "target_unavailable" };
  const [from] = await db
    .select({ courseId: trips.courseId })
    .from(trips)
    .where(and(eq(trips.id, input.fromTripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!from) return { ok: false, reason: "not_found" };
  const to = await openDeparture(db, input.shopId, input.toTripId, now);
  // A course interest waited for that course; a dive interest for a dive.
  if (!to || (to.courseId ?? null) !== (from.courseId ?? null)) {
    return { ok: false, reason: "target_unavailable" };
  }
  const carried = await copyInterests(db, { ...input, uninvitedOnly: false });
  return { ok: true, carried: carried.length };
}

export type SeriesInterestRoll = { rolled: number; invited: number };

/** How far back the nightly roll looks for a sailed date, so a missed night still rolls. */
const ROLL_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * **A series date sails with interests nobody invited: they roll to the next date
 * of the run.** Run nightly beside the series roll. Each uninvited interest joins
 * the wait list of the next date that takes a seat (a date on a conditions
 * hold is passed over). While that date has seats nobody has been invited to,
 * the existing wait-list invite goes out to its queue in the order people
 * asked (`deliverSeatOffer`, which stamps the interest and honors a
 * courtesy-email opt-out). An interest staff already invited was worked by a
 * person, and stays where they left it.
 */
export async function rollSailedSeriesInterests(
  db: AppDb,
  now: Date = nowDate(),
): Promise<SeriesInterestRoll> {
  const outcome: SeriesInterestRoll = { rolled: 0, invited: 0 };
  const sailedBy = new Date(now.getTime() - DEPARTURE_BUFFER_MS);
  const sailed = await db
    .selectDistinct({
      tripId: trips.id,
      shopId: trips.shopId,
      seriesId: trips.seriesId,
      startsAt: trips.startsAt,
      shopSlug: shops.slug,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .innerJoin(
      interests,
      and(
        eq(interests.scope, "departure"),
        eq(interests.tripId, trips.id),
        eq(interests.shopId, trips.shopId),
        eq(interests.askedBy, "diver"),
        isNull(interests.offeredAt),
        notADateRequest(db),
      ),
    )
    .where(
      and(
        isNotNull(trips.seriesId),
        liveTrip(),
        notRehearsal(),
        lte(trips.startsAt, sailedBy),
        gt(trips.startsAt, new Date(now.getTime() - ROLL_LOOKBACK_MS)),
      ),
    );
  for (const row of sailed) {
    if (!row.seriesId) continue;
    const [next] = await db
      .select()
      .from(trips)
      .where(
        and(
          liveTrip(),
          takesSeats(row.shopId),
          // The invite links the public page: a private date is never the next one.
          eq(trips.isPrivate, false),
          eq(trips.seriesId, row.seriesId),
          gt(trips.startsAt, now),
        ),
      )
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!next) continue;
    const interestIds = await copyInterests(db, {
      shopId: row.shopId,
      fromTripId: row.tripId,
      toTripId: next.id,
      uninvitedOnly: true,
    });
    outcome.rolled += interestIds.length;
    if (interestIds.length === 0) continue;
    // Invited only while the next date has a seat to give, and from that
    // date's whole queue in the order people asked: a rolled interest keeps the
    // time they first asked, so it takes its place in the line, never the
    // front of it. An interest rolled onto a full date waits there like anyone
    // else, for staff or the next roll.
    let open = await invitableSeats(db, next);
    if (open <= 0) continue;
    const queue = await db
      .select({ id: interests.id, partySize: interests.partySize })
      .from(interests)
      .where(
        and(
          eq(interests.shopId, row.shopId),
          eq(interests.scope, "departure"),
          eq(interests.tripId, next.id),
          eq(interests.askedBy, "diver"),
          isNull(interests.offeredAt),
          notADateRequest(db),
          notExists(db.select({ id: bookings.id }).from(bookings).where(seatedOn(next.id))),
        ),
      )
      // diveday:allow-time-id-order: the order invites go out in, shown to nobody; the id only breaks a tie between two interests who asked in the same instant.
      .orderBy(asc(interests.askedAt), asc(interests.id));
    // A party is invited only when the whole party fits (fourth review,
    // item 34): two divers are never split across dates. A party too big for
    // what is free waits, and a smaller interest behind it may still fit, since a
    // wait list is a set of interests, not a queue (ADR 20260813).
    for (const interest of queue) {
      if (open <= 0) break;
      const party = interest.partySize ?? 1;
      if (party > open) continue;
      await deliverSeatOffer(db, {
        shopId: row.shopId,
        shopSlug: row.shopSlug,
        tripId: next.id,
        interestId: interest.id,
        now,
        // Its own sentence: the date they asked for filled, this one has room
        // (fourth review, item 31).
        sailedStartsAt: row.startsAt,
      });
      // Stamped either way (the offer is recorded; a diver who opted out is
      // still offered by hand), and it holds the party's seats until it is
      // taken or goes stale.
      outcome.invited += 1;
      open -= party;
    }
  }
  return outcome;
}
