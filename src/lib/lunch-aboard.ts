/**
 * **Lunch aboard, and each person's meal preference** (fifth-loop ideas, item
 * 56).
 *
 * A long day boat that serves lunch says so on the departure; only then does
 * the diver's Day-of form ask for a lunch preference (vegetarian, halal), the
 * desk can write one on the roster, and Prep, the paper day, the manifest row
 * and the offline copy show it by name.
 *
 * **The note is a galley note, not an allergy record** (dive-domain review
 * B1). A food allergy is medical: it belongs on the person, on every
 * departure, lunch or not, with whether they carry an auto-injector, and that
 * record is a separate piece of work with its own security review. So the
 * form never invites one (its hint sends an allergy to the shop), nothing
 * here claims the crew has seen anything, the count says "N of M left a
 * note" rather than implying nobody has a restriction, and nothing gates
 * boarding.
 */

/** The longest dietary note a diver may leave. */
export const DIETARY_NOTE_MAX = 160;

/** A typed note trimmed and cut to {@link DIETARY_NOTE_MAX}; null when nothing is left. */
export function cleanDietaryNote(raw: string | null | undefined): string | null {
  const note = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, DIETARY_NOTE_MAX).trim();
  return note || null;
}

export type LunchNote = { name: string; note: string };

export type LunchSummary = {
  /** Everyone fed: every seat on the roster and the crew rostered aboard. */
  count: number;
  /** Each person's lunch note, by name. */
  notes: LunchNote[];
  /** Seats with a note, of {@link asked} seats: never read as "nobody has a restriction". */
  answered: number;
  asked: number;
};

/**
 * The lunch line for one departure, or null when lunch is not served aboard
 * (or the departure is cancelled, which feeds nobody).
 */
export function lunchSummary(input: {
  lunchAboard: boolean;
  cancelled: boolean;
  seats: readonly { fullName: string; dietaryNote: string | null }[];
  crewAboard: number;
}): LunchSummary | null {
  if (!input.lunchAboard || input.cancelled) return null;
  const notes = input.seats.flatMap((seat) => {
    const note = cleanDietaryNote(seat.dietaryNote);
    return note ? [{ name: seat.fullName, note }] : [];
  });
  return {
    count: input.seats.length + input.crewAboard,
    notes,
    answered: notes.length,
    asked: input.seats.length,
  };
}
