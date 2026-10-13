import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS, hasSailed } from "@/lib/trips";
import type { AppDb } from "./client";
import { bookings, shops, trips, tripWaitlistEntries } from "./schema";
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

/** A departure of this shop that still takes a seat: live, scheduled, not a rehearsal, not left. */
async function openDeparture(db: AppDb, shopId: string, tripId: string, now: Date) {
  const [trip] = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.shopId, shopId),
        liveTrip(),
        notRehearsal(),
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  return trip && !hasSailed(trip.startsAt, now) ? trip : null;
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
 * the next scheduled date's wait list, and when that date has a seat the
 * existing wait-list invite goes out at once (`inviteWaitlistDiver`, which
 * stamps the entry and honors a courtesy-email opt-out). A lead staff already
 * invited was worked by a person, and stays where they left it.
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
          eq(trips.shopId, row.shopId),
          eq(trips.seriesId, row.seriesId),
          liveTrip(),
          notRehearsal(),
          eq(trips.status, "scheduled"),
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
    // Invited only while the next date has a seat to give: a lead rolled onto
    // a full date waits there like anyone else, for staff or the next roll.
    const held = await heldSeatCounts(db, row.shopId, next.id);
    let open = (await sellableCapacity(db, next)) - held.aboard;
    for (const entryId of entryIds) {
      if (open <= 0) break;
      const invited = await inviteWaitlistDiver(db, {
        shopId: row.shopId,
        shopSlug: row.shopSlug,
        entryId,
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
