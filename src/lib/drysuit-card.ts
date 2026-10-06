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
 * **A warning, never a gate**, for the same reason as the depth ceiling (H-08).
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
 * suit or ours (H-78, issue #1752).
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
): DrysuitCardCheck {
  if (!divesDry) return { status: "ok" };
  if (holdsSpecialtyCard(specialtyCertifications, "drysuit")) return { status: "ok" };
  // The split is worth two sentences for the same reason `specialtyBlocker`
  // splits its codes: "nothing on file" and "one tap from cleared" are
  // different jobs for the staffer reading the roster.
  return specialtyCertifications.some((card) => card.specialty === "drysuit")
    ? { status: "unconfirmed" }
    : { status: "no_card" };
}
