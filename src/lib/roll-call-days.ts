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
 *   checkpoint that day and none on a later day at the dock or at that
 *   checkpoint or a later one ({@link seenAfter}, #4056), is still open on
 *   every later day ({@link carriedMissing}); the manifest keeps showing it,
 *   and Today keeps raising it.
 * - **An undo reaches back only to the mark it names.** A `cleared` on a
 *   later day that names an earlier day's standing `not_boarded` at the same
 *   checkpoint (`retracts`, written only after the write proved that mark was
 *   the one the manifest showed) is the crew taking that carried tap back, so
 *   it clears the earlier day's word too (the person reads as not yet counted
 *   there, never as missing). Any other `cleared` takes back its own day's
 *   mark and nothing earlier (#3981, #3995).
 */

export type RollCallStatus = "boarded" | "not_boarded" | "cleared";

/** One result, with the subject it is about and its meeting day (0-based). */
export type DayMark = {
  subject: string;
  checkpoint: string;
  status: RollCallStatus;
  day: number;
  /** The stored event's id, which a later `cleared` may name. */
  id?: string;
  /** On a `cleared`: the id of the event it takes back (`retracts_event_id`). */
  retracts?: string | null;
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
 * `cleared` (the caller reads it as nothing), and a `cleared` after a dive
 * that names an earlier day's standing `not_boarded` at the same checkpoint
 * takes that one back too, and no other.
 */
export function standingByDay<M extends DayMark>(marks: readonly M[]): Map<number, Map<string, M>> {
  const byDay = new Map<number, Map<string, M>>();
  for (const mark of marks) {
    const key = keyOf(mark.subject, mark.checkpoint);
    const day = byDay.get(mark.day) ?? new Map<string, M>();
    day.set(key, mark);
    byDay.set(mark.day, day);
    // A `cleared` takes back the mark standing just before it on its own day.
    // It reaches an earlier day only by naming that day's "did not come back"
    // (ADR 20260815-an-offline-retraction-names-its-target, #3995): a repeated
    // tap, or one that names its own day's mark, leaves the alarm standing.
    if (mark.status !== "cleared" || !isAfterDive(mark.checkpoint) || !mark.retracts) continue;
    for (const [earlier, standing] of byDay) {
      if (earlier >= mark.day) continue;
      const target = standing.get(key);
      if (target?.status === "not_boarded" && target.id === mark.retracts) standing.set(key, mark);
    }
  }
  return byDay;
}

/**
 * Whether a later day's count settles a subject's "not back aboard" at
 * `checkpoint` on `day` (#4056): a standing `boarded` on a day after `day` at
 * the dock, or at that checkpoint or a later one. A later day's "back aboard"
 * after an earlier dive is a tap at a dive not yet done that day, which a
 * mis-tap during a search past the day boundary would otherwise turn green;
 * the dock count says the person stood there since. A mark filed on a day
 * after `through` (a fast tablet) settles nothing, as at the missing-diver gate.
 */
export function seenAfter(
  standing: ReadonlyMap<number, ReadonlyMap<string, DayMark>>,
  subject: string,
  day: number,
  checkpoint: string,
  through = Number.POSITIVE_INFINITY,
): boolean {
  const dive = ordinalOf(checkpoint);
  for (const [later, marks] of standing) {
    if (later <= day || later > through) continue;
    for (const mark of marks.values()) {
      if (mark.subject !== subject || mark.status !== "boarded") continue;
      if (mark.checkpoint === "departure" || ordinalOf(mark.checkpoint) >= dive) return true;
    }
  }
  return false;
}

/**
 * The stated missing people of days before `currentDay` still open: a
 * standing `not_boarded` after a dive, not settled by a `boarded` at a later
 * checkpoint the same day, nor by a later day's count ({@link seenAfter}). Keyed by
 * subject and checkpoint, the earlier day's mark as the value (the newest
 * such day wins).
 */
export function carriedMissing<M extends DayMark>(
  standing: ReadonlyMap<number, ReadonlyMap<string, M>>,
  currentDay: number,
): Map<string, M> {
  const carried = new Map<string, M>();
  for (const mark of stillOpenEarlier(standing, currentDay)) {
    carried.set(keyOf(mark.subject, mark.checkpoint), mark);
  }
  return carried;
}

/** {@link carriedMissing}'s marks, every earlier day's, oldest day first. */
function stillOpenEarlier<M extends DayMark>(
  standing: ReadonlyMap<number, ReadonlyMap<string, M>>,
  currentDay: number,
): M[] {
  const open: M[] = [];
  const days = [...standing.keys()].filter((day) => day < currentDay).sort((a, b) => a - b);
  for (const day of days) {
    const marks = standing.get(day);
    if (!marks) continue;
    for (const mark of marks.values()) {
      if (mark.status !== "not_boarded" || !isAfterDive(mark.checkpoint)) continue;
      const dive = ordinalOf(mark.checkpoint);
      const settledThatDay = [...marks.values()].some(
        (other) =>
          other.subject === mark.subject &&
          other.status === "boarded" &&
          isAfterDive(other.checkpoint) &&
          ordinalOf(other.checkpoint) > dive,
      );
      if (settledThatDay || seenAfter(standing, mark.subject, day, mark.checkpoint, currentDay)) {
        continue;
      }
      open.push(mark);
    }
  }
  return open;
}

/**
 * **What a manifest shows now** for one departure (#2557): each subject's
 * standing result on the current meeting day, and, where the current day has
 * nothing at that checkpoint, an earlier day's stated missing still open. A
 * search that runs past the day boundary keeps its red row on the manifest
 * until the person is counted again, and a `cleared` tapped now takes an
 * earlier day's mis-tap back when it names it. Marks oldest first; `cleared` never comes back.
 */
export function manifestRollCallView<M extends DayMark>(
  marks: readonly M[],
  currentDay: number,
): Map<string, M> {
  const standing = standingByDay(marks);
  const view = new Map<string, M>();
  for (const [key, mark] of carriedMissing(standing, currentDay)) view.set(key, mark);
  // A standing `cleared` today is nothing today: an earlier day's stated
  // missing person it did not reach back to stays on the view (#3981).
  for (const [key, mark] of standing.get(currentDay) ?? new Map<string, M>()) {
    if (mark.status !== "cleared") view.set(key, mark);
  }
  return view;
}

/** A mark with the time it was taken, as the missing-diver gate reads it. */
export type TimedDayMark = DayMark & { occurredAt: Date };

/**
 * **When one person's standing "not back aboard" began**, as the manifest
 * shows it on `currentDay` (#4017): null when the manifest shows them nowhere
 * red after a dive. Gates the missing-diver report and alert, and Found.
 *
 * Marks are one subject's, **oldest first**. A red row is today's standing
 * `not_boarded` after a dive, or an earlier day's still open
 * ({@link carriedMissing}); every earlier day's open mark counts, even where
 * today has re-stated the same checkpoint, so the disappearance keeps its
 * first day. Each mark dates from the first `not_boarded` of the unbroken run
 * ending in it on its own day and checkpoint (an offline copy synced later is
 * the same alarm); the earliest wins, the time an insurer reads. A mark filed
 * on a day the server clock has not reached yet (a fast tablet) may add red
 * but never settles or takes back anything.
 */
export function notBackAboardSince<M extends TimedDayMark>(
  marks: readonly M[],
  currentDay: number,
): Date | null {
  // Marks up to today read as the manifest does. A mark from a day the server
  // has not reached yet (a fast tablet) can add red but settles nothing.
  const standing = standingByDay(marks.filter((mark) => mark.day <= currentDay));
  const red = stillOpenEarlier(standing, currentDay);
  const ahead = standingByDay(marks.filter((mark) => mark.day > currentDay));
  for (const marksOfDay of [standing.get(currentDay), ...ahead.values()]) {
    for (const mark of marksOfDay?.values() ?? []) {
      if (mark.status === "not_boarded" && isAfterDive(mark.checkpoint)) red.push(mark);
    }
  }
  let since: Date | null = null;
  for (const mark of red) {
    const start = runStart(marks, mark);
    if (!since || start < since) since = start;
  }
  return since;
}

/** The first `not_boarded` of the unbroken run that ends in `mark`, on its day and checkpoint. */
function runStart<M extends TimedDayMark>(marks: readonly M[], mark: M): Date {
  let start = mark.occurredAt;
  for (let i = marks.indexOf(mark) - 1; i >= 0; i--) {
    const earlier = marks[i];
    if (!earlier || earlier.day !== mark.day) continue;
    if (earlier.subject !== mark.subject || earlier.checkpoint !== mark.checkpoint) continue;
    if (earlier.status !== "not_boarded") break;
    start = earlier.occurredAt;
  }
  return start;
}

/**
 * Whether one person's marks (oldest first) say they are back aboard: their
 * last word ({@link lastWord}) is `boarded` and the manifest shows them
 * nowhere red after a dive ({@link notBackAboardSince}). An undo is not
 * "back": it takes a mark away without saying anyone came aboard, and no
 * marks at all is not back either.
 */
export function backAboardNow<M extends TimedDayMark>(
  marks: readonly M[],
  currentDay: number,
): boolean {
  return (
    lastWord(marks, currentDay)?.status === "boarded" &&
    notBackAboardSince(marks, currentDay) === null
  );
}

/**
 * The newest mark that says whether the person came back: one after a dive,
 * or a dock count on a later day than every after-dive mark before it, and no
 * later than `currentDay` (#4056): the count {@link seenAfter} reads. The
 * dock count on the day of the dive says nothing about after it.
 */
function lastWord<M extends DayMark>(marks: readonly M[], currentDay: number): M | undefined {
  let word: M | undefined;
  let afterDiveDay = Number.NEGATIVE_INFINITY;
  for (const mark of marks) {
    if (isAfterDive(mark.checkpoint)) {
      word = mark;
      afterDiveDay = Math.max(afterDiveDay, mark.day);
    } else if (
      afterDiveDay > Number.NEGATIVE_INFINITY &&
      mark.day > afterDiveDay &&
      mark.day <= currentDay
    ) {
      word = mark;
    }
  }
  return word;
}

/**
 * **Who is still unaccounted for after a dive, on any meeting day** (issue
 * #2404, #2557): on some day, a standing `not_boarded` after dive N with no
 * `boarded` after a later dive that day, and none on a later day at the dock
 * or after dive N or a later one ({@link seenAfter}).
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
