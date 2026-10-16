/**
 * **Lunch aboard, and who can't eat what** (fifth-loop ideas, item 56).
 *
 * A long day boat that serves lunch says so on the departure; only then does
 * the diver's Day-of form ask "Anything you can't eat?", and Prep and the paper
 * day say "Lunch for 14" with each answer by name. The note is for the galley.
 * A severe allergy is health-adjacent, so the form points the diver at telling
 * the shop directly as well, and nothing here gates boarding.
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
  /** What each person said they can't eat, by name. */
  notes: LunchNote[];
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
  return { count: input.seats.length + input.crewAboard, notes };
}
