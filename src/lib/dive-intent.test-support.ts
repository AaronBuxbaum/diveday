import { type DiveIntent, type DiveIntentCount, orderedDiveIntentCounts } from "./dive-intent";

/**
 * **The sentence a divemaster reads, as codes and counts.**
 *
 * Only answers given are counted: a `null` is a diver who was not asked or did
 * not say, and treating silence as an answer would invent a majority out of an
 * empty roster. Zero-count intents never appear, so the crew reads what is
 * aboard rather than a five-row table mostly full of noughts.
 *
 * Always in `DIVE_INTENTS` order rather than by size, so the sentence does not
 * reshuffle itself between two renders of the same boat.
 */
export function diveIntentTally(
  answers: readonly (DiveIntent | null | undefined)[],
): DiveIntentCount[] {
  const counts = new Map<DiveIntent, number>();
  for (const answer of answers) {
    if (!answer) continue;
    counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
  return orderedDiveIntentCounts(counts);
}
