import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { diverSeatLimit } from "@/lib/participant-types";
import { DEPARTURE_BUFFER_MS, hasSailed } from "@/lib/trips";
import { tripCourseCrewCounts } from "./bookings";
import type { AppDb } from "./client";
import { bookings, courses, shops, trips, tripWaitlistEntries } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";
import { inviteWaitlistDiver } from "./waitlist";

/**
 * **The wait list rolls forward** (third UX review, item 12). A wait list is a
 * set of leads the shop works (ADR 20260813-wait-list-is-a-lead-list); when the
 * departure they waited for fills and sails, or a second departure is put up
 * for them, the leads should not stay behind on a day that is gone or full.
 *
 * Both helpers **copy** entries rather than move them: the original row is the
 * record of what the diver asked for, and the unique (trip, person) index makes
 * a second run a no-op. An entry keeps the time the diver first asked, so the
 * list reads in the order people actually waited. Nobody already holding a seat
 * on the target is added. Nothing here ranks anyone: every lead travels.
 */

/** Copy one departure's waiting leads onto another of this shop's. Returns the new entries. */
async function copyLeads(
  db: AppDb,
  input: { shopId: string; fromTripId: string; toTripId: string; uninvitedOnly: boolean },
): Promise<string[]> {
  const leads = await db
    .select({ personId: tripWaitlistEntries.personId, createdAt: tripWaitlistEntries.createdAt })
    .from(tripWaitlistEntries)
    .where(
      and(
        eq(tripWaitlistEntries.shopId, input.shopId),
        eq(tripWaitlistEntries.tripId, input.fromTripId),
        input.uninvitedOnly ? isNull(tripWaitlistEntries.invitedAt) : undefined,
      ),
    )
    .orderBy(asc(tripWaitlistEntries.createdAt));
  if (leads.length === 0) return [];
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
          leads.map((lead) => lead.personId),
        ),
      ),
    );
  const onBoard = new Set(seated.map((row) => row.personId));
  const fresh = leads.filter((lead) => !onBoard.has(lead.personId));
  if (fresh.length === 0) return [];
  const inserted = await db
    .insert(tripWaitlistEntries)
    .values(
      fresh.map((lead) => ({
        shopId: input.shopId,
        tripId: input.toTripId,
        personId: lead.personId,
        createdAt: lead.createdAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: tripWaitlistEntries.id });
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
    eq(bookings.personId, tripWaitlistEntries.personId),
    ne(bookings.status, "cancelled"),
  );
}

/**
 * **How many invitations this departure can honor right now.** Measured as a
 * seat is measured when it is sold (`createBookingRecord`, `moveBooking`): the
 * boat's sellable seats, the divers-only limit, and for a course session the
 * instructor it needs and the ratio its crew allows. A wait-list lead asks for
 * a diver's seat, so the divers-only limit binds. Every invitation already out
 * to someone who has not taken a seat holds one of those seats, so it is taken
 * off. Advice for whom to invite, never a gate: the seat is still measured
 * under the trip's lock when the diver books. Exported for its test (agency
 * review G5 of #2226).
 */
export async function invitableSeats(db: AppDb, trip: typeof trips.$inferSelect): Promise<number> {
  const held = await heldSeatCounts(db, trip.shopId, trip.id);
  let room = (await sellableCapacity(db, trip)) - held.aboard;
  const diverLimit = diverSeatLimit(trip);
  if (diverLimit !== null) room = Math.min(room, diverLimit - held.divers);
  if (trip.courseId) {
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, trip.courseId), eq(courses.shopId, trip.shopId)))
      .limit(1);
    const { instructorCount, assistantCount } = await tripCourseCrewCounts(db, trip.id);
    if (instructorCount === 0) return 0;
    const ratioCap = courseSeatCapacity(course ?? null, instructorCount, assistantCount);
    // The students, its divers: a priced rider is a passenger (G5 of #2226).
    if (ratioCap !== null) room = Math.min(room, ratioCap - held.divers);
  }
  const [outstanding] = await db
    .select({ invited: count(tripWaitlistEntries.id) })
    .from(tripWaitlistEntries)
    .where(
      and(
        eq(tripWaitlistEntries.shopId, trip.shopId),
        eq(tripWaitlistEntries.tripId, trip.id),
        isNotNull(tripWaitlistEntries.invitedAt),
        notExists(db.select({ id: bookings.id }).from(bookings).where(seatedOn(trip.id))),
      ),
    );
  return Math.max(0, room - (outstanding?.invited ?? 0));
}

export type CarryWaitlistOutcome =
  | { ok: true; carried: number }
  | { ok: false; reason: "not_found" | "target_unavailable" };

/**
 * **"Carry the wait list" from the demand banner.** A full departure whose
 * leads are still waiting hands every one of them to another departure the
 * shop has put up, where the wait list's one-tap invite reaches them. Staff
 * choose the departure, and nobody is messaged until staff invite.
 */
export async function carryWaitlist(
  db: AppDb,
  input: { shopId: string; fromTripId: string; toTripId: string; now?: Date },
): Promise<CarryWaitlistOutcome> {
  const now = input.now ?? nowDate();
  if (input.fromTripId === input.toTripId) return { ok: false, reason: "target_unavailable" };
  const [from] = await db
    .select({ courseId: trips.courseId })
    .from(trips)
    .where(and(eq(trips.id, input.fromTripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!from) return { ok: false, reason: "not_found" };
  const to = await openDeparture(db, input.shopId, input.toTripId, now);
  // A course lead waited for that course; a dive lead for a dive.
  if (!to || (to.courseId ?? null) !== (from.courseId ?? null)) {
    return { ok: false, reason: "target_unavailable" };
  }
  const carried = await copyLeads(db, { ...input, uninvitedOnly: false });
  return { ok: true, carried: carried.length };
}

export type SeriesWaitlistRoll = { rolled: number; invited: number };

/** How far back the nightly roll looks for a sailed date, so a missed night still rolls. */
const ROLL_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * **A series date sails with leads nobody invited: they roll to the next date
 * of the run.** Run nightly beside the series roll. Each uninvited lead joins
 * the wait list of the next date that takes a seat (a date on a conditions
 * hold is passed over). While that date has seats nobody has been invited to,
 * the existing wait-list invite goes out to its queue in the order people
 * asked (`inviteWaitlistDiver`, which stamps the entry and honors a
 * courtesy-email opt-out). A lead staff already invited was worked by a
 * person, and stays where they left it.
 */
export async function rollSailedSeriesWaitlists(
  db: AppDb,
  now: Date = nowDate(),
): Promise<SeriesWaitlistRoll> {
  const outcome: SeriesWaitlistRoll = { rolled: 0, invited: 0 };
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
      tripWaitlistEntries,
      and(
        eq(tripWaitlistEntries.tripId, trips.id),
        eq(tripWaitlistEntries.shopId, trips.shopId),
        isNull(tripWaitlistEntries.invitedAt),
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
          eq(trips.seriesId, row.seriesId),
          gt(trips.startsAt, now),
        ),
      )
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!next) continue;
    const entryIds = await copyLeads(db, {
      shopId: row.shopId,
      fromTripId: row.tripId,
      toTripId: next.id,
      uninvitedOnly: true,
    });
    outcome.rolled += entryIds.length;
    if (entryIds.length === 0) continue;
    // Invited only while the next date has a seat to give, and from that
    // date's whole queue in the order people asked: a rolled lead keeps the
    // time they first asked, so it takes its place in the line, never the
    // front of it. A lead rolled onto a full date waits there like anyone
    // else, for staff or the next roll.
    let open = await invitableSeats(db, next);
    if (open <= 0) continue;
    const queue = await db
      .select({ id: tripWaitlistEntries.id })
      .from(tripWaitlistEntries)
      .where(
        and(
          eq(tripWaitlistEntries.shopId, row.shopId),
          eq(tripWaitlistEntries.tripId, next.id),
          isNull(tripWaitlistEntries.invitedAt),
          notExists(db.select({ id: bookings.id }).from(bookings).where(seatedOn(next.id))),
        ),
      )
      // diveday:allow-time-id-order: the order invites go out in, shown to nobody; the id only breaks a tie between two leads who asked in the same instant.
      .orderBy(asc(tripWaitlistEntries.createdAt), asc(tripWaitlistEntries.id));
    for (const entry of queue) {
      if (open <= 0) break;
      const invited = await inviteWaitlistDiver(db, {
        shopId: row.shopId,
        shopSlug: row.shopSlug,
        entryId: entry.id,
        now,
      });
      if (invited.ok) {
        outcome.invited += 1;
        open -= 1;
      }
    }
  }
  return outcome;
}
