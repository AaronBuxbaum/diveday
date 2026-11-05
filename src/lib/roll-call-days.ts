/**
 * **Roll-call results read day by day** (#2557, ADR 20261104-roll-call-by-meeting-day).
 *
 * A checkpoint is keyed per person (`after_dive_1`), not per meeting day, so
 * each result is filed under the meeting day it was taken on (`rollCallDayOf`,
 * `./trip-days.ts`; `rollCallDayIndex` in SQL) and every reader folds it here,
 * so the open-count detector, the manifest and the departure record agree.
 *
 * Two carry rules cross days, both about a person stated missing:
 *
 * - **Missing stays missing until they are counted again.** A standing
 *   `not_boarded` after a dive on an earlier day, with no `boarded` at a later
 *   checkpoint that day and no `boarded` anywhere on a later day, is still
 *   open on every later day ({@link carriedMissing}); the manifest keeps
 *   showing it, and Today keeps raising it.
 * - **An undo reaches back.** A `cleared` on a later day at the checkpoint
 *   where an earlier day's `not_boarded` stands is the crew taking that tap
 *   back, so it clears the earlier day's word too (the person reads as not yet
 *   counted there, never as missing).
 */

export type RollCallStatus = "boarded" | "not_boarded" | "cleared";

/** One result, with the subject it is about and its meeting day (0-based). */
export type DayMark = {
  subject: string;
  checkpoint: string;
  status: RollCallStatus;
  day: number;
};

const keyOf = (subject: string, checkpoint: string) => `${subject}\u0000${checkpoint}`;
const isAfterDive = (checkpoint: string) => checkpoint.startsWith("after_dive_");
const ordinalOf = (checkpoint: string) => {
  if (checkpoint === "departure") return 0;
  const dive = Number(checkpoint.slice("after_dive_".length));
  return Number.isInteger(dive) && dive >= 1 ? dive : Number.NaN;
};

/**
 * Each day's standing result per subject and checkpoint, from marks **oldest
 * first**: the newest mark on a day wins, a newest `cleared` stands as
 * `cleared` (the caller reads it as nothing), and a `cleared` also reaches
 * back to an earlier day's standing `not_boarded` at the same checkpoint.
 */
export function standingByDay<M extends DayMark>(marks: readonly M[]): Map<number, Map<string, M>> {
  const byDay = new Map<number, Map<string, M>>();
  for (const mark of marks) {
    const key = keyOf(mark.subject, mark.checkpoint);
    const day = byDay.get(mark.day) ?? new Map<string, M>();
    day.set(key, mark);
    byDay.set(mark.day, day);
    if (mark.status !== "cleared" || !isAfterDive(mark.checkpoint)) continue;
    for (const [earlier, standing] of byDay) {
      if (earlier >= mark.day) continue;
      if (standing.get(key)?.status === "not_boarded") standing.set(key, mark);
    }
  }
  return byDay;
}

/** Whether a subject has a standing `boarded` at any checkpoint on a day after `day`. */
export function seenAfter(
  standing: ReadonlyMap<number, ReadonlyMap<string, DayMark>>,
  subject: string,
  day: number,
): boolean {
  for (const [later, marks] of standing) {
    if (later <= day) continue;
    for (const mark of marks.values()) {
      if (mark.subject === subject && mark.status === "boarded") return true;
    }
  }
  return false;
}

/**
 * The stated missing people of days before `currentDay` still open: a
 * standing `not_boarded` after a dive, not settled by a `boarded` at a later
 * checkpoint the same day, and not counted on any later day. Keyed by
 * subject and checkpoint, the earlier day's mark as the value (the newest
 * such day wins).
 */
export function carriedMissing<M extends DayMark>(
  standing: ReadonlyMap<number, ReadonlyMap<string, M>>,
  currentDay: number,
): Map<string, M> {
  const carried = new Map<string, M>();
  const days = [...standing.keys()].filter((day) => day < currentDay).sort((a, b) => a - b);
  for (const day of days) {
    const marks = standing.get(day);
    if (!marks) continue;
    for (const [key, mark] of marks) {
      if (mark.status !== "not_boarded" || !isAfterDive(mark.checkpoint)) continue;
      const dive = ordinalOf(mark.checkpoint);
      const settledThatDay = [...marks.values()].some(
        (other) =>
          other.subject === mark.subject &&
          other.status === "boarded" &&
          isAfterDive(other.checkpoint) &&
          ordinalOf(other.checkpoint) > dive,
      );
      if (settledThatDay || seenAfter(standing, mark.subject, day)) continue;
      carried.set(key, mark);
    }
  }
  return carried;
}

/**
 * **What a manifest shows now** for one departure (#2557): each subject's
 * standing result on the current meeting day, and, where the current day has
 * nothing at that checkpoint, an earlier day's stated missing still open. A
 * search that runs past the day boundary keeps its red row on the manifest
 * until the person is counted again, and a `cleared` tapped now takes an
 * earlier day's mis-tap back. Marks oldest first; `cleared` never comes back.
 */
export function manifestRollCallView<M extends DayMark>(
  marks: readonly M[],
  currentDay: number,
): Map<string, M> {
  const standing = standingByDay(marks);
  const view = new Map<string, M>();
  for (const [key, mark] of carriedMissing(standing, currentDay)) view.set(key, mark);
  for (const [key, mark] of standing.get(currentDay) ?? new Map<string, M>()) {
    if (mark.status === "cleared") view.delete(key);
    else view.set(key, mark);
  }
  return view;
}

/**
 * **Who is still unaccounted for after a dive, on any meeting day** (issue
 * #2404, #2557): on some day, a standing `not_boarded` after dive N with no
 * `boarded` after a later dive that day, and no `boarded` on a later day.
 * Dive numbers are compared within a day only: day one's "back after dive 2"
 * says nothing about day two's dive 1.
 */
export function unaccountedSubjects(marks: readonly DayMark[]): Set<string> {
  return new Set(
    [...carriedMissing(standingByDay(marks), Number.POSITIVE_INFINITY).values()].map(
      (mark) => mark.subject,
    ),
  );
}
