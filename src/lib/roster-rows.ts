/**
 * **The roster's two pieces of arithmetic** — which letter a name files under,
 * and which one fact a row is allowed to say (ADR 20260827-people-not-lists,
 * decision 2: the roster is one ledger, grouped by initial letter, whose rows
 * carry a name, an exceptional badge and one quiet fact).
 *
 * Codes, never sentences: this module returns `{ kind: "lastAboard", at }` and
 * a bare letter, and the surface picks the words. Both halves are here rather
 * than in the component because both are rules with edges — a name that starts
 * with an accent, a name that starts with a digit, a diver who is both booked
 * and imported — and a rule with edges belongs where a test can reach it
 * without a DOM.
 */

/** The one fact a roster row says beside a name, worst-use-first. */
export type RosterRowFact =
  | { kind: "booked"; at: Date }
  | { kind: "lastAboard"; at: Date }
  | { kind: "imported" }
  | null;

/**
 * **A seat ahead outranks a visit behind, and both outrank provenance.**
 *
 * A row has space for one fact, and the counter's question is almost always
 * "are they coming back / when were they last out". A diver whose whole
 * history came across from another system says so instead — otherwise their
 * row is indistinguishable from somebody who has never been on a boat, which
 * is the exact confusion ADR 20260725-import-prior-visits exists to prevent.
 * A diver with neither says nothing: an absence is not a fact worth a line.
 */
export function rosterRowFact(facts: {
  nextBookingAt: Date | null;
  lastAboardAt: Date | null;
  importedOnly: boolean;
}): RosterRowFact {
  if (facts.nextBookingAt) return { kind: "booked", at: facts.nextBookingAt };
  if (facts.lastAboardAt) return { kind: "lastAboard", at: facts.lastAboardAt };
  if (facts.importedOnly) return { kind: "imported" };
  return null;
}

/**
 * The letter a name files under, or `null` when it does not start with one.
 *
 * Diacritics are folded, so "Ángel Ramos" files under **A** rather than under
 * a group of its own between Z and the digits — which is what a naive first
 * character produces and what a Spanish-speaking shop's roster is full of.
 * Folding is `NFD` plus dropping the combining marks: no table, no locale, and
 * the same answer in every runtime.
 *
 * `toUpperCase()` without a locale deliberately. The two locales this app
 * negotiates agree on every mapping this touches, and a locale-aware
 * uppercase would make a shop's letter groups depend on which language the
 * *reader* chose rather than on the roster's own sort.
 */
export function rosterLetter(fullName: string): string | null {
  const first = fullName.trim().normalize("NFD").replace(/\p{M}/gu, "").charAt(0);
  if (!first || !/\p{L}/u.test(first)) return null;
  return first.toUpperCase();
}

/** One letter group: its label (null for the names that start with no letter) and its rows. */
export type LetterGroup<T> = { letter: string | null; rows: T[] };

/**
 * **Groups are runs, not buckets.**
 *
 * The rows arrive in the order the roster query sorted them, and that order is
 * the product's answer to "what comes after what" — Postgres's collation,
 * which is not necessarily this function's idea of an alphabet. Starting a new
 * group whenever the letter changes preserves that order exactly; bucketing by
 * letter and re-sorting the buckets would quietly re-order the page under the
 * pager, so page 3 would no longer be the third page of anything.
 *
 * The visible cost is that an odd collation can render the same letter twice,
 * which is honest about the sort rather than hiding it.
 */
export function groupByLetter<T extends { letter: string | null }>(
  rows: readonly T[],
): LetterGroup<T>[] {
  const groups: LetterGroup<T>[] = [];
  for (const row of rows) {
    const open = groups.at(-1);
    if (open && open.letter === row.letter) open.rows.push(row);
    else groups.push({ letter: row.letter, rows: [row] });
  }
  return groups;
}
