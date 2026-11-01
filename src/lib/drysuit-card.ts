import type { SpecialtyCertification } from "@/db/schema";
import { holdsSpecialtyCard } from "./readiness";

/**
 * Whether a diver in a drysuit holds the card for one.
 *
 * `drysuit` is a modelled specialty and the shop's own record already knows who
 * holds it, so a diver in a suit with no drysuit training was a gap DiveDay
 * could see and never mentioned (`dive-domain-expert` review, 2026-09-12, on
 * the layer that made the drysuit a sized piece of its own). The failure mode
 * is specific: air in the suit expands on the way up, and a diver who has never
 * vented one rides it to the surface.
 *
 * **A warning, never a gate**, for the same reason as the depth ceiling (H-20260724-certification-levels-agency-rules).
 * A shop runs drysuit orientations, and on a course trip the instructor is
 * taking the diver through exactly this — refusing the seat would make DiveDay
 * wrong about the thing it was being careful about. Nothing here reaches
 * `calculateReadiness` or `trip-admission.ts`, and nothing may: readiness
 * refusals are a different instrument, and a shop that gates a drysuit dive
 * already has one (a site or trip requiring the `drysuit` specialty).
 */
export type DrysuitCardCheck =
  /** The diver is not in a drysuit, or holds a card that clears a drysuit gate. Say nothing. */
  | { status: "ok" }
  /** In a drysuit with no drysuit card on file at all. */
  | { status: "no_card" }
  /** In a drysuit with a drysuit card on file that has not cleared: a capture awaiting review, or an unconfirmed import. */
  | { status: "unconfirmed" };

/**
 * `divesDry` is the diver's own answer — `rental_fit_profiles.dives_dry`, their
 * suit or ours (H-20260916-rental-fit-describe-shop, issue #1752).
 *
 * This used to take `rents_drysuit` and the shop's catalog, and said nothing
 * unless a suit was coming off this shop's wall. That asked "are we renting
 * them a drysuit?" as a proxy for "will they be in one?", and it was silent for
 * the divers it is most about: most drysuit divers own the suit. The catalog
 * scoping went with it. It existed because a shop dropping drysuits left a
 * surviving rental flag with no checkbox to clear it; the suit is now one
 * choice on every fit form (`SuitChoice`, `src/lib/rentals.ts`), so the diver
 * or a staffer can always answer it, and a catalog edit says nothing about what
 * a diver wears.
 */
export function checkDrysuitCard(
  divesDry: boolean,
  specialtyCertifications: readonly SpecialtyCertification[],
  /**
   * `people.drysuit_experience_seen_at`: a staffer recorded seeing this diver
   * dive dry (issue #2136, Aaron 2026-10-13). It clears the `no_card`
   * advisory and nothing else; an unconfirmed card keeps firing (F4). It is not a card, so a site or trip requiring the `drysuit`
   * specialty still refuses without one. Required, so no caller can forget it.
   */
  drysuitExperienceSeenAt: Date | null,
): DrysuitCardCheck {
  if (!divesDry) return { status: "ok" };
  if (holdsSpecialtyCard(specialtyCertifications, "drysuit")) return { status: "ok" };
  // The split is worth two sentences for the same reason `specialtyBlocker`
  // splits its codes: "nothing on file" and "one tap from cleared" are
  // different jobs for the staffer reading the roster. A card awaiting review
  // keeps firing whatever a staffer saw: confirming the card is the fix
  // (domain review F4).
  if (specialtyCertifications.some((card) => card.specialty === "drysuit")) {
    return { status: "unconfirmed" };
  }
  return drysuitExperienceSeenAt !== null ? { status: "ok" } : { status: "no_card" };
}

/**
 * Whether "seen diving dry" may be recorded for this diver (issue #2136,
 * security review X2): they dive dry and have no drysuit card on file at all.
 * Exactly where the advisory says `no_card`; a card awaiting review has its
 * own fix (F4). The writer and the diver record both read this.
 */
export function drysuitExperienceRecordable(
  divesDry: boolean,
  specialtyCertifications: readonly Pick<SpecialtyCertification, "specialty">[],
): boolean {
  return divesDry && !specialtyCertifications.some((card) => card.specialty === "drysuit");
}

/**
 * Who may record it, by live roles (domain review A4): the people who lead
 * dives and would have watched one. A captain, crew or desk role may not.
 */
export const DRYSUIT_EXPERIENCE_RECORDER_ROLES = [
  "owner",
  "manager",
  "instructor",
  "assistant_instructor",
  "divemaster",
] as const;

export function canRecordDrysuitExperience(roles: readonly string[]): boolean {
  return roles.some((role) =>
    (DRYSUIT_EXPERIENCE_RECORDER_ROLES as readonly string[]).includes(role),
  );
}

/** Clearing is the recorder's, or an owner's or manager's (security review X3). */
export function canClearDrysuitExperience(roles: readonly string[], isRecorder: boolean): boolean {
  return (
    (isRecorder && canRecordDrysuitExperience(roles)) ||
    roles.some((role) => role === "owner" || role === "manager")
  );
}

/** The note's bounds, after trimming: what was seen, briefly. */
export const DRYSUIT_EXPERIENCE_NOTE_MAX = 200;
