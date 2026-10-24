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
 * - **A diver under {@link JUNIOR_YOUNGEST_BAND_END}.** A 10-11-year-old dives
 *   with a PADI Professional or a certified parent or guardian (glossary
 *   **Junior certification**), and only the divemaster can tell whether the
 *   adult beside them is either.
 * - **A seat whose "Under 18" box and date of birth disagree.** One of them is
 *   wrong, and which one decides who the party's adult is.
 * - **A minor with no date of birth.** The "Under 18" box says a seat is a
 *   minor and nothing about which band: it could be ten.
 * - **A diver under {@link JUNIOR_AGE_END} with no certified adult on file.** A
 *   12-14-year-old dives with a certified adult: a diver of {@link ADULT_AGE}
 *   or more, by a date of birth on file, holding a verified card, in the same
 *   party.
 * - **More than {@link PARTY_TEAM_MAX}.** A family of four arrives together
 *   and dives in pairs the divemaster picks.
 *
 * A seat with no date of birth and no "Under 18" box passes all of these as an
 * adult (H-08, H-113: the sale never asks an age), so two undeclared
 * thirteen-year-olds would pass. {@link partyAgesUnconfirmed} names those
 * parties, and one tap teams one only after a staffer confirms everyone in it
 * is 18 or over (issue 2808).
 *
 * Boring on purpose: plain comparisons, a fixed order, no scoring. The order
 * decides only which reason is said when several apply, so every age reason
 * comes before the size one: the divemaster who splits a family of four by
 * hand must be told there is a child in it (dive-domain review of layer r5-4,
 * second pass, F2). The bands are PADI's and SSI's, from `src/lib/age.ts`.
 */

import { ADULT_AGE, JUNIOR_AGE_END, JUNIOR_YOUNGEST_BAND_END } from "@/lib/age";

/** The largest party one tap makes a team of. */
export const PARTY_TEAM_MAX = 3;

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
  | "young_child"
  | "minor_age_conflict"
  | "minor_age_unknown"
  | "junior_without_adult"
  | "too_large";

/** The departure the party is on: its course, if it is one. */
export type PartyDeparture = { course: { intro: boolean } | null };

/**
 * Why this party needs a divemaster's decision, or null. One-tap planning
 * leaves it untouched; a hand-built team's panel shows the same reason as
 * an informational caution. A single diver beside crew can need one too.
 */
export function partyLeftReason(
  departure: PartyDeparture,
  members: readonly PartyMember[],
): PartyLeftReason | null {
  if (departure.course?.intro) return "intro_course";
  if (departure.course) return "training_course";
  if (members.some((member) => member.age !== null && member.age < JUNIOR_YOUNGEST_BAND_END)) {
    return "young_child";
  }
  if (
    members.some((member) => member.declaredMinor && member.age !== null && member.age >= ADULT_AGE)
  ) {
    return "minor_age_conflict";
  }
  if (members.some((member) => member.age === null && member.declaredMinor)) {
    return "minor_age_unknown";
  }
  const junior = members.some((member) => member.age !== null && member.age < JUNIOR_AGE_END);
  const certifiedAdult = members.some(
    (member) => member.age !== null && member.age >= ADULT_AGE && member.verifiedCard,
  );
  if (junior && !certifiedAdult) return "junior_without_adult";
  if (members.length > PARTY_TEAM_MAX) return "too_large";
  return null;
}

/**
 * Whether one tap must ask a staffer to confirm this party is all adults
 * before teaming it: some member has neither a date of birth nor the "Under 18"
 * box, so nothing on file says how old they are. A ticked box is not asked
 * about, because `partyLeftReason` already leaves that party; a verified card
 * says nothing about age.
 */
export function partyAgesUnconfirmed(members: readonly PartyMember[]): boolean {
  return members.some((member) => member.age === null && !member.declaredMinor);
}
