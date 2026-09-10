/**
 * **Self check-in at the counter** (N-24): the rules behind the tablet a diver
 * types their own name into, kept framework-free.
 *
 * The one thing this surface must never do is board anybody. Arrival is the
 * desk's question — "are you here?" — and boarding is the rail's, performed by
 * a crew member at roll call with the diver in front of them. The two
 * vocabularies are already kept apart at the table and the type (`arrival_status`
 * has deliberately no `boarded`, ADR 20260907-the-counter-survives-offline), and
 * a lobby tablet is exactly the device that would blur them if anything here
 * were allowed to reach the manifest. Nothing in this module or its writer does.
 */

/** How long a typed answer may run. A surname, or a booking reference. */
export const KIOSK_INPUT_MAX = 80;

/** The kiosk's path for a raw token, encoded so a caller can never detach the segment. */
export function kioskCheckInPath(token: string): string {
  return `/check-in/${encodeURIComponent(token)}`;
}

/**
 * **Accents are folded on both sides, exactly and only these.**
 *
 * Case was already folded and nothing else was, so "Ana García Márquez" was
 * found by `garcía` and refused `garcia` — in the same market the two-apellido
 * fix was for, with the same "See the desk" a stranger gets (issue #1656). A
 * diver typing at a counter on whatever keyboard the shop's tablet is set to
 * skips a diacritic they would never skip on paper.
 *
 * A table rather than a normalization pass, because the same folding has to be
 * written a second time in SQL and the two must not drift: `FOLD_FROM` and
 * `FOLD_TO` are built from this one list and handed to Postgres `translate()`,
 * which folds character for character. `unaccent` would read better and is
 * available in PGlite, but it is `STABLE` rather than `IMMUTABLE`, so it can
 * never back an index, and on Neon it is an extension to install and a
 * permission to hold — a dependency this list does not need.
 *
 * `lower()` runs first on both sides, so only lower-case forms appear here.
 *
 * **What it deliberately does not fold**: anything whose unaccented form is
 * more than one character — the German ß, the ligatures æ and œ. `translate()`
 * maps one character to one character, and a diver who types `ss` for ß is a
 * different question from one who drops an acute.
 */
const FOLDINGS: readonly (readonly [string, string])[] = [
  ["áàâäãåāăą", "a"],
  ["çćčĉċ", "c"],
  ["ďđ", "d"],
  ["éèêëēĕėęě", "e"],
  ["ĝğġģ", "g"],
  ["ĥħ", "h"],
  ["íìîïĩīĭįı", "i"],
  ["ĵ", "j"],
  ["ķ", "k"],
  ["ĺļľł", "l"],
  ["ñńņň", "n"],
  ["óòôöõōŏőø", "o"],
  ["ŕŗř", "r"],
  ["śŝşšș", "s"],
  ["ţťțŧ", "t"],
  ["úùûüũūŭůűų", "u"],
  ["ŵ", "w"],
  ["ýÿŷ", "y"],
  ["źżž", "z"],
];

/** The two `translate()` arguments, and the reason they are exported: `src/db/kiosk-check-in.ts` folds with them. */
export const FOLD_FROM = FOLDINGS.map(([from]) => from).join("");
export const FOLD_TO = FOLDINGS.map(([from, to]) => to.repeat(from.length)).join("");

const FOLDED = new Map(
  FOLDINGS.flatMap(([from, to]) => [...from].map((character) => [character, to] as const)),
);

/**
 * One word, lower-cased and folded — the form both sides of the lookup compare.
 *
 * `lower()` before the fold on the Postgres side too, so an accented capital
 * (`Á`) becomes `á` and then `a` by the same two steps in both languages.
 */
export function foldNameWord(word: string): string {
  return [...word.toLowerCase()].map((character) => FOLDED.get(character) ?? character).join("");
}

/**
 * The **word a diver answers with**: the last whitespace-separated word of what
 * they typed.
 *
 * Deliberately crude, and deliberately not a parser. A person standing at a
 * tablet answers one question — "last name?" — and whether they answer
 * "Marquez", "Garcia Marquez" or their whole name, the word that identifies
 * them is the last one. It is matched exactly and case-insensitively against
 * the stored name's own {@link matchableNameTokens}, never as a substring.
 */
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return foldNameWord(parts.at(-1) ?? "");
}

/**
 * Words that are nobody's key.
 *
 * A `security-reviewer` pass on the widening below found that it had quietly
 * turned a surname-entropy lookup into an enumerable one: "Jan van der Berg"
 * made *der* a valid whole-word answer, "Luis de la Cruz" made *la* one, and a
 * stored middle initial made a **single letter** one. Roughly sixty tries —
 * the particles, the suffixes, the alphabet — fit inside one hour of
 * `RATE_LIMITS.kioskLookup` twice over, and every hit both names a stranger's
 * departure and writes an arrival on their booking.
 *
 * So a word can only be a key *in the middle of a name* when it is at least
 * three characters and not one of these. The **last** word is always a key
 * whatever its length, which is what keeps "Wei Li" reachable by *Li* — the
 * behaviour that predates the widening and the reason a bare minimum length
 * would have been the wrong instrument.
 */
const NOT_A_KEY = new Set([
  "abu",
  "bin",
  "ben",
  "das",
  "del",
  "den",
  "der",
  "dos",
  "ibn",
  "mac",
  "ter",
  "van",
  "von",
]);

const canBeKey = (word: string) => word.length >= 3 && !NOT_A_KEY.has(word);

/**
 * The words of a **stored** name a diver may be found by.
 *
 * The last word alone was wrong in the market the Spanish bundle exists for.
 * A diver recorded as "Ana Garcia Marquez" was reachable only by *Marquez*, the
 * maternal apellido, while anyone asked for *su apellido* answers *Garcia* — so
 * under the "Apellido" prompt the tablet refused every Hispanic diver, with a
 * refusal deliberately indistinguishable from "we do not know you" (issue
 * #1610). Both apellidos have to work, and the same widening carries a Dutch
 * tussenvoegsel ("Jan van der Berg", found by *Berg*) and a compound English
 * surname.
 *
 * So: the last word always, plus every word before it that is not a given name
 * and {@link canBeKey} — where "the given names" is the first word, or the
 * first **two** when the name runs to four or more. That second clause is what
 * keeps "Maria Jose Garcia Marquez" from being found by *Jose*.
 *
 * A single-word name is its own surname, as it always was.
 *
 * **What this does not claim.** A middle given name in a three-word name *is* a
 * key: "Ana Maria Gomez" answers to *Maria*, and no positional rule can tell
 * that name from "Ana Garcia Marquez" (`security-reviewer`, 2026-09-10). What
 * bounds the cost is everything around it — the exact whole-word match, the
 * collapse of zero and many into one "see the desk", the tablet's own two-hour
 * window, and the per-link rate limit — not the boundary. Read
 * `src/lib/rate-limit.ts`'s `kioskLookup` note beside this one; the budget was
 * sized against surname entropy, and this rule spends some of it.
 *
 * `src/db/kiosk-check-in.ts` writes this same rule in SQL, and asks the
 * length-and-particle half of it about the *typed* word — which is the same
 * question, since a match means both sides are the same string.
 */
export function matchableNameTokens(fullName: string): readonly string[] {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map(foldNameWord);
  if (parts.length <= 1) return parts;
  const last = parts.at(-1) ?? "";
  const middle = parts.slice(parts.length >= 4 ? 2 : 1, -1).filter(canBeKey);
  return [...new Set([...middle, last])];
}

/**
 * Whether a typed answer is allowed to match a word **before** the last one.
 *
 * The SQL asks this about the typed word rather than filtering the stored ones,
 * and the two are the same question: an equality match means both sides hold
 * the same string, so refusing a short or particle *answer* refuses exactly the
 * short and particle *tokens* — except the last word, which stays a key on both
 * sides.
 */
export function canMatchBeforeTheLastWord(typed: string): boolean {
  return canBeKey(typed);
}

/**
 * **Every answer this tablet gives takes at least this long.**
 *
 * The refusals are word-for-word identical on purpose — a miss, an ambiguous
 * surname, a sailed departure, a cancelled seat and a diver readiness will not
 * clear are one sentence, so a lobby screen cannot be used to work out which of
 * two people has a medical hold. That property was true of the words and false
 * of the clock: reaching "see the desk" from a miss is one `SELECT`, and
 * reaching the same sentence from a blocked diver is a transaction, a row lock,
 * a support-needs query and a full readiness read (issue #1608). Measured on
 * the seeded shop over PGlite in-process: 5ms against 24ms, and the gap widens
 * on a networked database, where the slow path pays four more round trips.
 *
 * 750ms clears both by an order of magnitude and costs a lobby nothing — the
 * card the tablet returns stands on the glass for twelve seconds.
 *
 * **What it does not cover**, stated rather than implied: a floor hides a
 * difference only while the slow path stays under it. A database slow enough to
 * push a readiness read past 750ms leaks the same signal again, and no constant
 * can fix that — only a slower floor, which a diver waits through.
 */
export const KIOSK_RESPONSE_FLOOR_MS = 750;

/**
 * How much longer an answer that took `elapsedMs` has to be held.
 *
 * Pure, so the floor is testable without a test that sleeps: a wall-clock
 * assertion on a shared runner is exactly the flake this repository refuses.
 */
export function kioskResponseWaitMs(
  elapsedMs: number,
  floorMs: number = KIOSK_RESPONSE_FLOOR_MS,
): number {
  if (!Number.isFinite(elapsedMs)) return floorMs;
  return Math.max(0, floorMs - Math.max(0, elapsedMs));
}

export type KioskInput =
  | { kind: "booking"; bookingId: string }
  | { kind: "surname"; surname: string }
  | null;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the one box on the kiosk was given: a scanned booking reference, or a
 * name to look up. `null` for anything unusable, which the surface answers with
 * the same sentence it answers a miss with — see `kioskSelection`.
 */
export function readKioskInput(raw: unknown): KioskInput {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > KIOSK_INPUT_MAX) return null;
  if (UUID_SHAPE.test(value)) return { kind: "booking", bookingId: value.toLowerCase() };
  return { kind: "surname", surname: surnameOf(value) };
}

/**
 * **One match is an answer; none and several are the same answer.**
 *
 * This is the security shape of the whole surface, not a convenience. A tablet
 * in a lobby is operated by whoever walks up to it, so anything that varies
 * with *how many* people called Nwosu are on today's boats tells a stranger
 * something about the shop's divers. Collapsing zero and many into one
 * "see the desk" leaves the tapper knowing only what they already knew.
 *
 * It is also the right operational answer. Two divers sharing a surname is
 * precisely the case a staffer has to resolve by looking at a person, and a
 * tablet guessing between them would check in the wrong one — an arrival on
 * somebody else's record, which the crew then reads as "they are here".
 */
export function kioskSelection<T>(matches: readonly T[]): T | null {
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
