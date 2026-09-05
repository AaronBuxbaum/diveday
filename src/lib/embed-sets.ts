/**
 * **Named embed lists**, framework-free (issue #1284): the cap on how many
 * things one list may hold, how a submitted membership is cleaned up, and the
 * one codec the generator's select and the settings page have to agree on.
 *
 * Codes and values only, never sentences — the words for every refusal below
 * live in `staff/settings.json` (AGENTS.md).
 */

/**
 * How many departures or courses one list may hold.
 *
 * A list is a *selection* a visitor scrolls past on a shop's own page; a shop
 * naming more than two dozen boats is publishing its whole board, which the
 * grid widget already does without a list. The number is also the bound on the
 * `in (…)` the widget's read builds, and it is enforced by a check constraint
 * so it holds against a hand-built request as well as against the form.
 */
export const EMBED_SET_MAX = 24;

/**
 * A submitted membership, cleaned up, or the reason it is not one.
 *
 * The two refusals are told apart because they are two different sentences on
 * screen: an empty list needs "pick at least one", and an over-cap one needs
 * the number. Never a silent truncation — dropping the shop's 25th choice
 * without saying so would leave them looking at a saved list missing one boat
 * with nothing to explain it.
 */
export type EmbedSetMembers =
  | { ok: true; ids: string[] }
  | { ok: false; reason: "empty" | "too_many" };

/** Trimmed, empties dropped, duplicates collapsed keeping the first occurrence. */
export function normalizeEmbedSetMembers(ids: readonly string[]): EmbedSetMembers {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (id) seen.add(id);
  }
  // Counted after the duplicates collapse: a shop that somehow submitted the
  // same boat twice has not chosen 25 things.
  if (seen.size === 0) return { ok: false, reason: "empty" };
  if (seen.size > EMBED_SET_MAX) return { ok: false, reason: "too_many" };
  return { ok: true, ids: [...seen] };
}

/**
 * What one `<select>` can carry when its options are two different namespaces.
 *
 * "What it shows" offers one departure or one course (a `show`) alongside the
 * shop's named lists (a `set`), and both are opaque strings. The prefix is what
 * tells them apart in the one place they share a value — everywhere else the
 * two travel as separate fields, and the widget reads them from separate
 * attributes.
 */
export const EMBED_SET_VALUE_PREFIX = "set:";

export type EmbedChoice = { show: string | null; set: string | null };

/** The select value for a choice; the empty string for "everything". */
export function encodeEmbedChoice(choice: EmbedChoice): string {
  if (choice.set) return `${EMBED_SET_VALUE_PREFIX}${choice.set}`;
  return choice.show ?? "";
}

/**
 * A select value read back. A bare id — which is what every already-pasted
 * snippet and every existing option carries — decodes as a `show` and never as
 * a `set`, so nothing about the existing choice changes shape.
 */
export function decodeEmbedChoice(value: string): EmbedChoice {
  if (value.startsWith(EMBED_SET_VALUE_PREFIX)) {
    const set = value.slice(EMBED_SET_VALUE_PREFIX.length);
    return { show: null, set: set || null };
  }
  return { show: value || null, set: null };
}
