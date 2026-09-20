import { Hull, type HullSeatContent } from "@/components/boat/Hull";
import { hullGeometry, type SeatReadiness, seatReadingFor } from "@/lib/hull";
import { seatIsHeld } from "@/lib/no-show";
import { rosterRowIsBlocked } from "@/lib/roster-filters";
import type { ReadinessByBooking, RosterEntry } from "./types";

/**
 * The bookings a seat is drawn for: the ones that still hold one.
 *
 * **Not "every row on the roster"**, which is what the first build drew and
 * which is wrong in both directions (dive-domain review 20260919). `getTripRoster`
 * returns every booking that is not cancelled, and `SEAT_HELD_STATUSES` is
 * narrower than that: a staffer who marks a diver **no-show** has said the
 * person is not coming and released the seat for the counter to sell. Drawing
 * that row meant:
 *
 * - **A boat that reads full over a seat that is free** — the exact regression
 *   the glossary's *Seat held* entry exists to prevent, and one this component
 *   re-spelled instead of reading.
 * - **A diver silently off the picture.** Six places, six booked, one no-show,
 *   one walk-up onto the freed seat: seven non-cancelled rows and six seats, and
 *   `Hull` draws one seat per *place*, so the newest booking — the person
 *   standing on the dock — was the one that fell off.
 * - **A picture contradicting its own sentence**, which counted `trip.booked`
 *   (seat-held) beside seats that did not.
 *
 * One predicate for the seats and for the sentence beside them settles all
 * three, and makes the overflow unreachable rather than merely unlikely: the
 * booking transaction enforces capacity over exactly these statuses.
 */
export function seatHoldersOf(roster: readonly RosterEntry[]): readonly RosterEntry[] {
  return roster.filter((entry) => seatIsHeld(entry.booking.status));
}

/**
 * **The departure, as its boat** — ADR 20260919-one-idea, decision I · Tide:
 * "a departure's page is Deck's hull".
 *
 * The roster, drawn: one seat per place the boat has, filled in booking order,
 * wearing the state the dock has for that diver. A crew sees the shape of the
 * morning before reading a name — how full, how many cannot board, how much
 * room is left — and then reads the rows underneath for every one of those
 * facts in words.
 *
 * **This is the dock's question, not the deck's.** Nothing here reads a roll
 * call: a seat is open, booked, blocked or awaiting, and the recorded outcomes
 * belong to the manifest, where a human is actually calling names.
 * `seatReadingFor` is the one derivation either way, so the two surfaces
 * cannot disagree about what a colour means — this one passes no `at` at all,
 * which is how it says it has no head count to draw.
 *
 * **It adds no fact and gates nothing.** Every seat is a row below it; the
 * capacity, the counts and the blockers are the page's, unchanged. Take the
 * picture away and the page still says everything it said.
 *
 * **A blocked seat is drawn from a predicate that fails open**, so this caller
 * does not ask it first. `rosterRowIsBlocked` answers "not blocked" both for a
 * diver somebody cleared and for one nobody has read, and an absence of
 * evidence painting as a clearance is the one thing a picture of a boat must
 * not do. The two sets agree today — the readiness map and the roster come out
 * of one `getTripGuests` batch over the same non-cancelled bookings — but
 * nothing pins that, so `readinessOf` below checks for the booking's absence
 * from the map *before* the predicate and hands `seatReadingFor` an honest
 * `unknown`, which `Hull` now draws as its own dashed seat (ADR
 * 20260919-one-idea §3b.5, closed).
 *
 * Nothing here may become the reason a person boards, either way.
 */
/**
 * What readiness says about one booking, including that nobody has said
 * anything — the three-way answer `rosterRowIsBlocked` cannot give on its own
 * (ADR 20260919-one-idea §3b.5).
 *
 * The map is keyed by booking id over the same batch the roster came from, so
 * a missing key is not "ready": it is the readiness read never having happened
 * for this seat. Asked in this order, the fail-open predicate only ever sees a
 * readiness that exists.
 */
export function readinessOf(byBooking: ReadinessByBooking, bookingId: string): SeatReadiness {
  const readiness = byBooking.get(bookingId)?.readiness;
  if (readiness === undefined) return "unread";
  return rosterRowIsBlocked(readiness) ? "blocked" : "ready";
}

export function TripHull({
  roster,
  readinessByBooking,
  capacity,
  color,
  label,
  crew,
}: {
  /** Bookings in booking order — which is the order `getTripRoster` returns. */
  roster: readonly RosterEntry[];
  readinessByBooking: ReadinessByBooking;
  capacity: number;
  /** The shop's colour for this hull, or null for one nobody has painted. */
  color: string | null;
  /** The whole boat in one sentence, already worded by the caller. */
  label: string;
  /**
   * The guides assigned to this departure, by their full names — shortened
   * here, beside the divers', rather than at the page: the wheelhouse holds two
   * letters, and a caller that handed `Hull` a name put "Keiko Tanaka" across
   * the bow of a 390px boat.
   */
  crew?: readonly string[];
}) {
  /**
   * **Every crew member counts, lettered or not.** This used to drop the ones
   * `initialsOf` could not letter — a blank or symbol-only name — from the
   * array it then measured, so those people left the *geometry* as well as the
   * lettering and the boat drew one circle fewer than it had crew. A person
   * with an awkward name is still a person on the boat. The gap is a hole in
   * the letters now, which `Hull` already draws as a plain circle.
   */
  const crewInitials = (crew ?? []).map((name) => initialsOf(name));
  const geometry = hullGeometry({ capacity, crewCount: crewInitials.length });
  const seats: HullSeatContent[] = seatHoldersOf(roster).map((entry) => ({
    reading: seatReadingFor({
      booking: {
        /*
         * **Three answers, because there are three** (ADR 20260919-one-idea
         * §3b.5). `rosterRowIsBlocked` fails open, so it answers "not blocked"
         * both for a diver somebody cleared and for one nobody has read — and
         * collapsing those into `ready` here is what made the picture say
         * "fine" where the truth was "nobody looked". The map missing the
         * booking entirely is the honest signal for the second case, and it is
         * read *before* the predicate rather than through it.
         */
        readiness: readinessOf(readinessByBooking, entry.booking.id),
      },
      // No `at` and no `recorded`: this page has no roll call in it, so the
      // seat answers the dock's question and `SeatPlace` will not let a
      // recorded tone in without the head count it came from.
    }),
    initials: initialsOf(entry.person.fullName),
  }));

  return (
    <Hull
      geometry={geometry}
      label={label}
      seats={seats}
      color={color}
      crewInitials={crewInitials}
      className="block h-auto w-full"
    />
  );
}

/**
 * Two letters from a name, for a seat.
 *
 * First and last where a name has two parts and the first two letters where it
 * has one, which is what a crew writes on a slate. A name in a script with no
 * spaces gets its first two characters — `Array.from` rather than `slice`, so
 * a surrogate pair is one character rather than half of one and the seat never
 * shows a broken glyph.
 */
function initialsOf(name: string): string | undefined {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const letters =
    parts.length > 1
      ? [first(parts[0]), first(parts[parts.length - 1])]
      : Array.from(parts[0]).slice(0, 2);
  const initials = letters.join("").toUpperCase();
  return initials.length > 0 ? initials : undefined;
}

function first(word: string): string {
  return Array.from(word)[0] ?? "";
}
