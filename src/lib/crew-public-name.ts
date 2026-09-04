/**
 * **The name a consenting crew member shows divers** (issue #1351).
 *
 * D21 publishes a staff member's first name, per-trip role and languages on a
 * page anyone on the internet can read, and the only thing enforcing that
 * boundary is the sentence beside the checkbox. Until this, the published
 * string was `full_name.trim().split(/\s+/)[0]` — which is not a first name, it
 * is a guess that the shop typed the given name first. A row entered "Tanaka
 * Keiko", or "Okonkwo, Talia" off a spreadsheet, published the **surname**
 * instead, silently and to a crawler.
 *
 * So the person types what ships. These functions are the whole of the rule,
 * and they live here rather than in `src/db` because both the writer and the
 * form that defaults the input need the same answer.
 */

/**
 * The longest public name we will store.
 *
 * This is the one field in the product where a staff member types a string that
 * renders on an anonymous, indexed page, so it is bounded — a cap and a trim
 * are cheap, and the crew line is one row of a card that a 200-character
 * "name" would wreck. Generous enough for a full given name in any script we
 * support, and for the double-barrelled ones a cap of 20 would have refused.
 */
export const CREW_PUBLIC_NAME_MAX = 40;

/**
 * What the consent form offers before anybody edits it.
 *
 * **`Surname, Given` is read, not guessed at.** A comma in a name field is the
 * one place a record states its own order rather than implying it — it is what
 * a spreadsheet export puts there — so everything after the first comma is the
 * given name, and the comma never travels with it. Without this, "Smith, John"
 * defaulted to `"Smith,"`: the surname, with punctuation, one tap from a public
 * page.
 *
 * **A space-separated name is still a guess, and stays one.** "Marcus Webb" and
 * "Tanaka Keiko" are the same string to a parser, and the issue's own proposed
 * change chose the first token so the ordinary case stays one tap. What makes
 * that safe now is not the guess getting better — it is that the guess is shown
 * to the person it belongs to, in a box labelled with what it does, instead of
 * being computed behind them at render time. A shop with surname-first records
 * sees "Tanaka" under "Name divers see" and corrects it.
 */
export function defaultCrewPublicName(fullName: string): string {
  const cleaned = collapse(fullName);
  const comma = cleaned.indexOf(",");
  const given = comma === -1 ? cleaned : cleaned.slice(comma + 1);
  return cap(collapse(given).split(" ")[0] ?? "");
}

/**
 * What a submitted form actually stores, or null when there is nothing to
 * publish.
 *
 * An empty box falls back to the default rather than refusing: somebody who
 * ticks the consent and clears the field has said yes, and the shop's own
 * record is the best thing to publish for them.
 *
 * Null only when there is no name at all to fall back on. `setCrewPublicConsent`
 * turns that into a refusal rather than writing a consent with nothing to show,
 * which the check constraint on `people` rejects anyway.
 */
export function crewPublicNameToStore(
  input: string | null | undefined,
  fullName: string,
): string | null {
  const typed = cap(collapse(input ?? ""));
  if (typed !== "") return typed;
  const fallback = defaultCrewPublicName(fullName);
  return fallback === "" ? null : fallback;
}

/**
 * One line of text: no invisibles, single spaces, no ends.
 *
 * The format characters go first and go entirely. `\s` does not cover them, and
 * this is the only string in the product a staff member writes that reaches an
 * anonymous page — an unterminated U+202E inside a name reverses the role and
 * languages rendered after it in the same row, because browsers resolve bidi
 * across the whole block rather than per span. It is text spoofing rather than
 * script injection (React escapes the value either way), and the fix belongs
 * here, at the one choke point, rather than at each surface that renders it.
 *
 * The control characters become spaces rather than vanishing, so a name pasted
 * with a newline in it reads "Mary Jane" and not "MaryJane".
 */
function collapse(value: string): string {
  return value
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cut to {@link CREW_PUBLIC_NAME_MAX}, counting characters rather than UTF-16
 * code units: `slice` would halve a surrogate pair on an emoji or an
 * astral-plane script and store a lone surrogate, which Postgres encodes as a
 * replacement character. Trimmed after, because a cut that lands on a space
 * would otherwise store one at the end.
 */
function cap(value: string): string {
  return [...value].slice(0, CREW_PUBLIC_NAME_MAX).join("").trim();
}
