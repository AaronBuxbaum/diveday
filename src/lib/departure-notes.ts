import { hasSailed } from "./trips";

/**
 * **A note to everyone on a departure** (batch 4, J4): "Marina lot closed,
 * park at the Elks", sent once to every booked seat by its usual channel.
 *
 * Transactional, so it is held to what a transactional message is: short,
 * about this departure, and carrying no link but the diver's own `/ready`
 * page, which DiveDay adds. The rules here are the whole check; the send
 * (`src/db/departure-notes.ts`) runs them at the hold and again when the hold
 * drains, so a departure cancelled during the eight seconds is not messaged.
 */

/** The longest note, in characters, after whitespace is folded. */
export const DEPARTURE_NOTE_MAX = 200;

/**
 * How many notes one departure may carry. A note goes to everyone; a fourth
 * is a newsletter, and the cap is what keeps one staff login from turning the
 * shop's sender into a megaphone.
 */
export const DEPARTURE_NOTES_PER_DEPARTURE = 3;

export type DepartureNoteProblem = "empty" | "too_long" | "link";

/** One line: every run of whitespace, newlines included, becomes one space. */
export function foldDepartureNote(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/**
 * Whether text carries anything a reader's phone would turn into a link: a
 * scheme, a `www.`, an address, or a bare domain (`elks.org`, `bit.ly/x`). A
 * dot between two letter runs is enough, so "park at the Elks.Meet" is refused
 * too; the fix is the space the sentence wanted anyway. "a.m." and "e.g."
 * pass, because the part after the last dot is one letter. Unicode look-alikes
 * are folded first (NFKC, and `。` `｡` `．` as dots), so `evil。example` is a
 * link too.
 */
export function containsLink(raw: string): boolean {
  // Read as a phone's linkifier would: compatibility forms folded (fullwidth
  // letters, `．`), and the ideographic and halfwidth full stops, which some
  // resolvers accept as a domain's dot, read as dots.
  const text = raw.normalize("NFKC").replace(/[\u3002\uFF61\uFF0E]/g, ".");
  return (
    /[a-z][a-z0-9+.-]*:\/\//i.test(text) ||
    /\bwww\./i.test(text) ||
    /[^\s@]+@[^\s@]+/.test(text) ||
    /[\p{L}\p{N}-]\.[\p{L}]{2,}/u.test(text)
  );
}

/** Why a note may not be sent as written, or null when it may. */
export function departureNoteProblem(body: string): DepartureNoteProblem | null {
  const folded = foldDepartureNote(body);
  if (folded.length === 0) return "empty";
  if (folded.length > DEPARTURE_NOTE_MAX) return "too_long";
  if (containsLink(folded)) return "link";
  return null;
}

export type DepartureNoteBlock = "cancelled" | "past" | "limit";

/**
 * Why this departure takes no note now, or null when it does. A cancelled
 * departure has its own messages (the blow-out, the cancellation), and one
 * that has sailed has nobody left to tell where to park.
 *
 * A multi-day course has sailed when its **last** day has (#2393): after day
 * one its students still have days two and three to turn up for, and those
 * are the people a "parking moved" note is for. `lastDayStartsAt` is that
 * day's start; absent or earlier, the departure's own start decides.
 */
export function departureNoteBlock(
  trip: { status: string; startsAt: Date; lastDayStartsAt?: Date | null },
  sentSoFar: number,
  now: Date,
): DepartureNoteBlock | null {
  if (trip.status !== "scheduled") return "cancelled";
  const lastStart =
    trip.lastDayStartsAt && trip.lastDayStartsAt.getTime() > trip.startsAt.getTime()
      ? trip.lastDayStartsAt
      : trip.startsAt;
  if (hasSailed(lastStart, now)) return "past";
  if (sentSoFar >= DEPARTURE_NOTES_PER_DEPARTURE) return "limit";
  return null;
}
