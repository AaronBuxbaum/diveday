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
  return (parts.at(-1) ?? "").toLowerCase();
}

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
 * So: every word except the given names, where "the given names" is the first
 * word, or the first **two** when the name runs to four or more. That second
 * clause is what keeps "Maria Jose Garcia Marquez" from being found by *Jose* —
 * compound given names are as ordinary in Spanish as compound surnames, and a
 * rule of "anything but the first word" would have made a given name matchable
 * for a large part of the market.
 *
 * A single-word name is its own surname, as it always was.
 *
 * **What stops this being a roster browser is no longer that given names are
 * excluded.** It is the exact whole-word match — never `like '%…%'`, so one
 * letter sweeps nothing — and the collapse of zero and many into the same
 * "see the desk", which is what a stranger typing a common name meets.
 * `src/db/kiosk-check-in.ts` writes this same rule in SQL.
 */
export function matchableNameTokens(fullName: string): readonly string[] {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
  if (parts.length <= 1) return parts;
  return parts.slice(parts.length >= 4 ? 2 : 1);
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
