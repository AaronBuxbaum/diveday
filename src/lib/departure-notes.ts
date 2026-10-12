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
 * pass, because the part after the last dot is one letter.
 */
export function containsLink(text: string): boolean {
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
 */
export function departureNoteBlock(
  trip: { status: string; startsAt: Date },
  sentSoFar: number,
  now: Date,
): DepartureNoteBlock | null {
  if (trip.status !== "scheduled") return "cancelled";
  if (hasSailed(trip.startsAt, now)) return "past";
  if (sentSoFar >= DEPARTURE_NOTES_PER_DEPARTURE) return "limit";
  return null;
}
