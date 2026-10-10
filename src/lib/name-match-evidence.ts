import { type CalendarDate, isValidCalendarDate } from "./calendar-date";

/**
 * The counter's name-match prompt lists up to five candidates, each under the
 * last dive day this shop can put behind the name (`SimilarDiver`,
 * `src/db/divers.ts`). This is the one rule that says when a candidate with no
 * such day gets a line of its own rather than silence, so that the three doors
 * rendering the prompt cannot answer it two ways.
 *
 * **Silence is honest only when every candidate is silent**
 * (`dive-domain-expert`, 2026-09-11). "No dive days here yet" under five blanks
 * distinguishes nobody from nobody and is five lines of noise. Under a sibling
 * reading "Last dive day here: Wed, Aug 26" it is the whole question: a blank
 * beside a date reads as *the one with the date is the real diver*, and biases
 * the tap toward the record that already has cards — which is the wrong
 * direction exactly when the person at the counter is the genuine first-timer
 * namesake, and a tap on the wrong record is what later hands a roster someone
 * else's certifications.
 */
export function noDiveDayNeedsSaying(matches: readonly { lastDiveDayAt: Date | null }[]): boolean {
  return matches.some((match) => match.lastDiveDayAt !== null);
}

/**
 * The date of birth a candidate's line may print, or null when it prints
 * nothing (H-79, issue #1698).
 *
 * Null is the normal case at this prompt: the staff create-diver form does not
 * ask for a date of birth, so a record the counter made has none. The three
 * doors print the line only when this returns a date, so a missing or
 * malformed value leaves no empty label and no stray separator beside the
 * contact line.
 */
export function candidateBirthDate(match: { dateOfBirth: string | null }): CalendarDate | null {
  const { dateOfBirth } = match;
  return dateOfBirth && isValidCalendarDate(dateOfBirth) ? dateOfBirth : null;
}
