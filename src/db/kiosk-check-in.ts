import { and, asc, eq, gte, inArray, isNull, lte, type SQL, sql } from "drizzle-orm";
import { isMinorOnDate } from "@/lib/age";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  canMatchBeforeTheLastWord,
  FOLD_FROM,
  FOLD_TO,
  type KioskInput,
  type KioskLookup,
} from "@/lib/kiosk-check-in";
import { kioskArrivalsWindow } from "@/lib/operational-window";
import { verifyBookingCapability } from "./booking-capabilities";
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
 * anyway.
 *
 * **Two was too few, and the shortfall answered "one" where the truth was
 * "several".** The `LIMIT` runs in Postgres; the minor filter and the
 * same-person collapse below run afterwards, in this function. So a token
 * matching one diver's two seats plus a second diver's read back as two rows
 * belonging to one person, collapsed to one, and checked that diver in — while
 * a stranger also matched and nobody was sent to the desk. A minor first in the
 * order did the same by being dropped. Multi-day package holders are exactly
 * that shape (`security-reviewer`, 2026-09-10).
 *
 * Six is above anything those two filters can drop plus a same-person run, on a
 * query already bounded to one morning's board, and still nothing like reading
 * a hundred rows to reach the same sentence.
 */
const MATCH_LIMIT = 6;

/**
 * **`matchableNameTokens` written in SQL, off one normalization.** The stored
 * name is lower-cased, its whitespace runs collapsed to single spaces, trimmed,
 * folded through `translate` (the `foldNameWord` of #1656, off the same two
 * strings), and split once. Both halves below read that same array, which is
 * what stops them disagreeing: `btrim` with one argument strips spaces only, so
 * a name with a leading tab used to shift the array by one and make a *given
 * name* matchable in SQL while the TypeScript rule refused it
 * (`security-reviewer`, 2026-09-10).
 *
 * Two ways to match, and the split is the point. The **last** word always,
 * whatever its length -- "Wei Li" answers to *Li*, as it did before any of
 * this. Any earlier word only when the typed answer itself may be a key, which
 * is the same question as filtering the stored words: an equality match means
 * both sides hold the same string, so refusing a short or particle answer
 * refuses exactly the short and particle tokens. Without that, a stored initial
 * was a one-character key and a tussenvoegsel a three-character one, and sixty
 * tries enumerated a morning's board.
 *
 * Never `like '%...%'`, on either branch.
 *
 * Taking the stored name as an expression rather than reading `people.fullName`
 * is what lets the parity test in `kiosk-check-in.test.ts` ask this predicate
 * about a literal, one cheap row at a time, instead of paying for the join
 * below once per word of every name it walks. Written the other way the test
 * that holds the two rules together grew until it timed out on a CI shard, and
 * a parity test nobody can afford to run is the rule drifting again.
 */
export function kioskNameMatch(storedName: SQL, typed: string): SQL {
  return sql`(select
    ${typed} = w.words[array_length(w.words, 1)]
    ${
      canMatchBeforeTheLastWord(typed)
        ? sql`or ${typed} = ANY(
            w.words[
              (case
                when array_length(w.words, 1) >= 4 then 3
                when array_length(w.words, 1) >= 2 then 2
                else 1
              end):
            ]
          )`
        : sql``
    }
    from (
      select regexp_split_to_array(
        translate(
          btrim(regexp_replace(lower(${storedName}), '\\s+', ' ', 'g')),
          ${FOLD_FROM},
          ${FOLD_TO}
        ),
        ' '
      ) as words
    ) w)`;
}

/**
 * **The booking behind a scanned arrival code, or nothing at all.**
 *
 * The purpose is stated here and it is the whole point: the card a diver saves,
 * prints and can forward carries an `arrival` credential, and the readiness
 * token that authorized the download — their medical, waiver and payment
 * surface — is not a key to this door (issue #1600). `verifyBookingCapability`
 * answers `null` for every other reason too: unknown token, expired, revoked,
 * a since-cancelled booking, a called-off trip.
 *
 * The shop is re-checked against the display link's own, because the token and
 * the tablet arrive from different people. A code minted at one shop must not
 * open another's counter, and a capability is not a tenant claim.
 *
 * Nothing here answers the caller differently from a miss: it returns a lookup
 * or `null`, and `null` reaches the same "See the desk" a typed surname nobody
 * holds reaches.
 */
async function bookingForArrivalCode(
  db: AppDb,
  shopId: string,
  token: string,
  now: Date,
): Promise<KioskLookup | null> {
  const capability = await verifyBookingCapability(db, { token, purpose: "arrival", now });
  if (!capability || capability.shopId !== shopId) return null;
  return { kind: "booking", bookingId: capability.bookingId };
}

/**
 * Seats on today's departures that this typed (or scanned) answer could name.
 *
 * A **booking reference** matches that booking and nothing else. A **surname**
 * matches any of the stored name's own `matchableNameTokens` — every word but
 * the given names — exactly and case-insensitively, never a substring, so
 * typing one letter cannot sweep the day's roster, and never on the email
 * address, which nobody says out loud at a counter. Both apellidos of "Ana
 * García Márquez" therefore work, which under an "Apellido" prompt is the
 * difference between a feature and a box that says no (issue #1610).
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
  // **A scanned code becomes an ordinary booking lookup here, before a seat is
  // read.** Every filter below is a promise this surface makes — the tablet's
  // own two-hour window, a live scheduled trip, a seat that is neither
  // cancelled nor a deleted person's, the diver who stated a support need and
  // the minor, both of whom meet a human — and resolving the credential in
  // `src/app/check-in/[token]/actions.ts` instead would hand `checkInAtKiosk` a
  // booking that passed none of them.
  const lookup: KioskLookup | null =
    input.lookup.kind === "capability"
      ? await bookingForArrivalCode(db, input.shopId, input.lookup.token, now)
      : input.lookup;
  if (!lookup) return [];
  const arrivals = kioskArrivalsWindow(now);
  const match =
    lookup.kind === "booking"
      ? eq(bookings.id, lookup.bookingId)
      : kioskNameMatch(sql`${people.fullName}`, lookup.surname);

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
    // `people.shop_id` stated rather than inherited from the booking's own
    // scoping. This door has no staffer behind it, and `checkInAtKiosk` writes
    // every predicate it depends on for that reason; the name predicate below
    // reads a column on this table, so the table's tenant belongs here too.
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, input.shopId)))
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
