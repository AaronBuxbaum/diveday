/**
 * **Which parties "Team up each party" may team in one tap** (fifth-loop ideas,
 * item 50; dive-domain review of layer r5-4, BLOCK 1).
 *
 * A party is the diver seats that booked together (`partyLeadBookingId`). One
 * tap makes each party of two or three a buddy team, and a divemaster reads
 * the teams out at the briefing, so a team this module lets through is a team
 * that gets in the water. Everything it is unsure of is left for the
 * divemaster, with the reason, never guessed:
 *
 * - **A course departure.** An intro (DSD, Try Scuba) participant always dives
 *   with an instructor (glossary **DSD**); a student on a training dive is the
 *   instructor's to place. Two friends on either are not a self-reliant pair.
 * - **More than {@link PARTY_TEAM_MAX}.** A family of four arrives together
 *   and dives in pairs the divemaster picks.
 * - **A diver under {@link CHILD_AGE_LIMIT}.** A 10-11-year-old dives with a
 *   PADI Professional or a certified parent or guardian (glossary **Junior
 *   certification**), and only the divemaster can tell whether the adult beside
 *   them is either.
 * - **A minor with no date of birth.** The "Under 18" box says a seat is a
 *   minor and nothing about which band: it could be ten.
 * - **A diver under {@link JUNIOR_AGE_LIMIT} with no certified adult.** A
 *   12-14-year-old dives with a certified adult: a diver of
 *   {@link ADULT_AGE} or more, by a date of birth on file, holding a verified
 *   card, in the same party.
 *
 * Boring on purpose: plain comparisons, a fixed order, no scoring. The order
 * decides only which reason is said when several apply.
 */

/** The largest party one tap makes a team of. */
export const PARTY_TEAM_MAX = 3;
/** Under this age a junior is the divemaster's to place, adult or not. */
export const CHILD_AGE_LIMIT = 12;
/** Under this age a junior needs a certified adult in the party. */
export const JUNIOR_AGE_LIMIT = 15;
/** The age a party's certified adult has reached. */
export const ADULT_AGE = 18;

/** One diver seat in a party, as the decision needs it. */
export type PartyMember = {
  /** Whole years on the departure's local date; null with no date of birth on file. */
  age: number | null;
  /** The seat's "Under 18" box was ticked. */
  declaredMinor: boolean;
  /** The person holds a verified card with this shop. */
  verifiedCard: boolean;
};

/** Why a party was left for the divemaster. Codes; the words are the manifest bundle's. */
export type PartyLeftReason =
  | "intro_course"
  | "training_course"
  | "too_large"
  | "young_child"
  | "minor_age_unknown"
  | "junior_without_adult";

/** The departure the party is on: its course, if it is one. */
export type PartyDeparture = { course: { intro: boolean } | null };

/**
 * Why this party may not be teamed in one tap, or null when it may. A party
 * of one is not a party and is never asked about.
 */
export function partyLeftReason(
  departure: PartyDeparture,
  members: readonly PartyMember[],
): PartyLeftReason | null {
  if (departure.course?.intro) return "intro_course";
  if (departure.course) return "training_course";
  if (members.length > PARTY_TEAM_MAX) return "too_large";
  if (members.some((member) => member.age !== null && member.age < CHILD_AGE_LIMIT)) {
    return "young_child";
  }
  if (members.some((member) => member.age === null && member.declaredMinor)) {
    return "minor_age_unknown";
  }
  const junior = members.some((member) => member.age !== null && member.age < JUNIOR_AGE_LIMIT);
  const certifiedAdult = members.some(
    (member) => member.age !== null && member.age >= ADULT_AGE && member.verifiedCard,
  );
  if (junior && !certifiedAdult) return "junior_without_adult";
  return null;
}
