import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { isMinorOnDate } from "@/lib/age";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { KioskInput } from "@/lib/kiosk-check-in";
import { kioskArrivalsWindow } from "@/lib/operational-window";
import type { AppDb } from "./client";
import { bookings, diveSupportNeeds, people, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **What the counter tablet is allowed to look up** (N-24).
 *
 * One reader, over the tablet's **own** window (`kioskArrivalsWindow`,
 * src/lib/operational-window.ts) — strictly narrower at both ends than the
 * staffed counter's, for the reasons written up there: a six-hour lookback told
 * an oversleeping diver "You're set" for a boat that had already sailed and
 * returned, and a thirty-six-hour reach made every multi-day package holder
 * ambiguous every morning. It detects nothing of its own and answers nothing
 * about readiness: the
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
  const arrivals = kioskArrivalsWindow(now);
  const match =
    input.lookup.kind === "booking"
      ? eq(bookings.id, input.lookup.bookingId)
      : // The same derivation `surnameOf` applies to what was typed, applied to
        // the stored name in Postgres: the last whitespace-separated word,
        // lower-cased. Anchored and whole-word, never `like '%…%'`.
        sql`lower(regexp_replace(btrim(${people.fullName}), '^.*\\s', '')) = ${input.lookup.surname}`;

  const rows = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      personName: people.fullName,
      dateOfBirth: people.dateOfBirth,
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
    // **A diver who has told the shop they need a hand goes to the desk.**
    // Support needs never gate boarding and must never start doing so — this
    // is not a gate, it is a routing rule about which door answers. The whole
    // point of a stated need is that a person meets a person: a diver who
    // needs help aboard or a lift into the water starts that conversation at
    // arrival, and a tablet saying "You're set" is how the crew first hears
    // about it on the boat instead (`dive-domain-expert` review, 2026-09-09).
    .leftJoin(
      diveSupportNeeds,
      and(eq(diveSupportNeeds.personId, people.id), eq(diveSupportNeeds.shopId, input.shopId)),
    )
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(trips.shopId, input.shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        inArray(bookings.status, ["booked", "checked_in"]),
        isNull(people.deletedAt),
        isNull(diveSupportNeeds.id),
        gte(trips.startsAt, arrivals.from),
        lte(trips.startsAt, arrivals.to),
        match,
      ),
    )
    // Earliest departure first, so the tie-break below can take the first row
    // rather than sorting a second time.
    .orderBy(asc(trips.startsAt))
    .limit(MATCH_LIMIT);

  // **A minor goes to the desk too**, for the same reason and not as a gate: a
  // valid guardian co-signature makes a fourteen-year-old `ready`, and a shop
  // whose practice is to see the guardian at the counter should not have the
  // tablet answer instead. Filtered here rather than in SQL because majority is
  // calendar arithmetic on the departure's own date, and it discloses nothing
  // to drop the row — every refusal is the same sentence.
  const eligible = rows.filter(({ dateOfBirth, startsAt }) => {
    if (!dateOfBirth) return true;
    return !isMinorOnDate(dateOfBirth, calendarDateInTimezone(startsAt, "UTC"));
  });

  // **One diver's own two departures are not an ambiguity — they are a
  // sequence.** Two seats behind one surname belonging to two *people* is
  // dangerous and stays "See the desk": a tablet must never guess which
  // stranger is standing in front of it. The same diver booked on this
  // morning's boat and tonight's night dive is a different question, and the
  // answer a lobby wants is the nearer one — somebody at 07:40 is arriving for
  // the 08:00 boat. Rows are already earliest-first.
  const seats =
    eligible.length > 1 && eligible.every((row) => row.personId === eligible[0].personId)
      ? eligible.slice(0, 1)
      : eligible;

  return seats.map(({ dateOfBirth: _dateOfBirth, personId: _personId, ...seat }) => seat);
}
