import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { KioskInput } from "@/lib/kiosk-check-in";
import { arrivalsWindow } from "@/lib/operational-window";
import type { AppDb } from "./client";
import { bookings, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **What the counter tablet is allowed to look up** (N-24).
 *
 * One reader, over the same arrivals window the staff counter uses
 * (`arrivalsWindow`, src/lib/operational-window.ts), so "today's departures"
 * means the same thing on the tablet in the lobby and the phone behind the
 * desk. It detects nothing of its own and answers nothing about readiness: the
 * *decision* to let a diver through belongs to `checkInAtKiosk`, which re-reads
 * live readiness the way every other arrival door does.
 *
 * The row shape is deliberately narrow, and the narrowness is the point rather
 * than an economy. This is read by whoever walks up to an unattended screen, so
 * it carries no email, no phone number, no readiness, no blocker, no money and
 * no other diver — nothing that would make standing at the tablet typing
 * surnames worth anybody's time. `kioskSeatShapeIsClosed` in the test file pins
 * the key set, so widening it is a failing test rather than a quiet leak into a
 * lobby.
 */
export type KioskSeat = {
  bookingId: string;
  /** The one diver this answer is about, and only once they are the one match. */
  personName: string;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  meetingPointLabel: string | null;
  meetingPointAddress: string | null;
};

/**
 * How many matching seats are worth reading before the answer is "see the desk"
 * anyway. Two is enough to know the answer is not one, and reading a hundred
 * rows to reach the same sentence is work a lobby tablet should not do.
 */
const MATCH_LIMIT = 2;

/**
 * Seats on today's departures that this typed (or scanned) answer could name.
 *
 * A **booking reference** matches that booking and nothing else. A **surname**
 * matches on the last whitespace-separated word of the stored name, exactly and
 * case-insensitively — never a substring, so typing one letter cannot sweep the
 * day's roster, and never on the email address, which nobody says out loud at a
 * counter.
 *
 * Cancelled seats are excluded, deleted people are excluded, and the departure
 * has to be live and scheduled. Anything else is not a seat somebody is
 * arriving for.
 */
export async function findKioskSeats(
  db: AppDb,
  input: { shopId: string; lookup: KioskInput; now?: Date },
): Promise<KioskSeat[]> {
  if (!input.lookup) return [];
  const now = input.now ?? nowDate();
  const arrivals = arrivalsWindow(now);
  const match =
    input.lookup.kind === "booking"
      ? eq(bookings.id, input.lookup.bookingId)
      : // The same derivation `surnameOf` applies to what was typed, applied to
        // the stored name in Postgres: the last whitespace-separated word,
        // lower-cased. Anchored and whole-word, never `like '%…%'`.
        sql`lower(regexp_replace(btrim(${people.fullName}), '^.*\\s', '')) = ${input.lookup.surname}`;

  return db
    .select({
      bookingId: bookings.id,
      personName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      meetingPointLabel: trips.meetingPointLabel,
      meetingPointAddress: trips.meetingPointAddress,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        inArray(bookings.status, ["booked", "checked_in"]),
        isNull(people.deletedAt),
        gte(trips.startsAt, arrivals.from),
        lte(trips.startsAt, arrivals.to),
        match,
      ),
    )
    .limit(MATCH_LIMIT);
}
