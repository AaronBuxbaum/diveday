import type { diveIntent } from "@/db/schema";

/**
 * **What a diver came for**, in one optional tap on the booking form (ADR
 * 20260904-reef-all-the-way-down, D12/#1172, with D23/#1183 folded into the
 * count below).
 *
 * The question the shipped form asked as a 300-character textarea — "what kind
 * of dive would make your day?" — which a crew had to read seat by seat and
 * which arrived in whatever language the diver typed. Five plain answers make
 * the same question countable, and a count is what a divemaster can act on
 * before a boat leaves.
 *
 * **Nothing in this file gates anything.** There is no ranking, no minimum, no
 * pairing. D12's boundary and D23's are the same sentence — a soft cue, never a
 * promise or a pairing rule — so a shop that reads the tally and does nothing
 * has lost nothing, and a diver who answers nothing is not a diver with a gap
 * in their record.
 */
export type DiveIntent = (typeof diveIntent.enumValues)[number];

/**
 * The five answers, in the order they are offered and counted.
 *
 * A runtime tuple with a `satisfies`, the same guard shape as
 * `DIVE_RECENCY_BANDS`: adding a value to the pgEnum without adding it here is
 * a **compile error**, so the form can never quietly stop offering an answer
 * the column accepts.
 *
 * `easing_back` leads because it is the one answer the product acts on (D18's
 * offers hang off it), and the rest run from the most specific interest to the
 * least.
 */
export const DIVE_INTENTS = [
  "easing_back",
  "small_life",
  "a_wreck",
  "skills",
  "good_day",
] as const satisfies readonly DiveIntent[];

/** One answer and how many divers on this departure gave it. Never a name. */
export type DiveIntentCount = { intent: DiveIntent; count: number };

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
  return DIVE_INTENTS.flatMap((intent) => {
    const count = counts.get(intent) ?? 0;
    return count > 0 ? [{ intent, count }] : [];
  });
}

/** A posted or stored value narrowed to one of the five, or null. Never trusts the post. */
export function parseDiveIntent(value: unknown): DiveIntent | null {
  return typeof value === "string" && (DIVE_INTENTS as readonly string[]).includes(value)
    ? (value as DiveIntent)
    : null;
}
