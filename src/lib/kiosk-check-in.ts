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
 * The **surname** in a full name: the last whitespace-separated word.
 *
 * Deliberately crude, and deliberately not a parser. What it is for is the one
 * question a person standing at a tablet answers — "last name?" — and the
 * lookup it feeds is exact and case-insensitive against this same derivation on
 * the stored name, so a diver recorded as "Adaeze Nwosu" is found by "nwosu"
 * and nothing else. A shop that records a name the other way round finds the
 * diver by their booking reference instead, which is what the scanned code
 * carries.
 */
export function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts.at(-1) ?? "").toLowerCase();
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
