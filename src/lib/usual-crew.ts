/**
 * **Which rows on the staff board may keep quiet about their crew.**
 *
 * A board that printed "Crew: Keiko Tanaka, Sal Moretti" on every row would be
 * saying the same thing eight times and hiding the one row that matters. So a
 * crew line is printed only where it is the *exception* — and that needs a
 * rule, not an eyeball, which is what this module is.
 *
 * It lived inside `ScheduleBuilder.tsx` until 2026-09-20, when the week became
 * the board's one reading (issue #1923, finishing slice 23f of ADR
 * 20260919-one-idea). Two compositions asking the same question of two copies
 * of the predicate is how they drift, and this one is load-bearing: a row that
 * printed a crew at 1279px and went quiet at 1280 would make the exception
 * invisible at exactly the width a manager plans a week on.
 *
 * Framework-free and pure, so `usual-crew.test.ts` can hold the thresholds
 * without a database or a render.
 */

/**
 * The crew signature this board mostly runs with, or `null` when it has none.
 *
 * **It is never printed.** The standing "Usual crew: …" sentence it used to
 * feed is gone (surfaces.md's "Remove first" for this board, and the
 * `20260908-one-hand` canvas); what it answers is only which rows may keep
 * quiet, so that every row that does print one is the exception a manager is
 * scanning for.
 *
 * A signature is the assignment in the order the row already prints it, so two
 * departures crewed by the same two people in a different order count as two
 * different answers — which is the honest reading, since that ordering is the
 * shop's own (lead first) rather than incidental.
 *
 * Returns `null` unless one signature covers at least three departures *and*
 * more than half the window. Both halves matter: below three, a per-row line
 * still reads as the exception it is, and without the majority there is no
 * "usual" to state. Departures with nobody assigned are excluded from the vote
 * and can never win it — "nobody" is the gap the line exists to show, never a
 * habit the board should start excusing.
 *
 * **What "the window" is changed when the stream went.** It used to be a
 * cursor page of every upcoming departure; it is now the seven days on screen.
 * That is the better reading and not merely the available one: "usual" over
 * the week a manager is looking at is a claim about that week, while "usual"
 * over an arbitrary page of the future was a claim about nothing in
 * particular. A quiet week rarely clears the bar, so on a quiet week every row
 * keeps its line — which is correct, because on a week with three departures
 * there is no habit to be an exception to.
 */
export function mostCommonCrew(
  departures: readonly { crew: readonly string[] }[],
): string[] | null {
  const counts = new Map<string, { crew: string[]; count: number }>();
  for (const departure of departures) {
    if (departure.crew.length === 0) continue;
    const key = departure.crew.join("\u0000");
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { crew: [...departure.crew], count: 1 });
  }
  let best: { crew: string[]; count: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  if (!best || best.count < 3 || best.count * 2 <= departures.length) return null;
  return best.crew;
}

/** Does this departure run with the board's usual crew, in the same order? */
export function isUsualCrew(crew: readonly string[], usual: readonly string[] | null): boolean {
  return usual !== null && crew.length === usual.length && crew.every((n, i) => n === usual[i]);
}
