import type { SpecialtyCertification } from "@/db/schema";
import { holdsSpecialtyCard } from "./readiness";

/**
 * Whether the diver taking a rental drysuit holds the card for one.
 *
 * `drysuit` is a modelled specialty and the shop's own record already knows who
 * holds it, so a suit going out to a diver with no drysuit training was a gap
 * DiveDay could see and never mentioned (`dive-domain-expert` review,
 * 2026-09-12, on the layer that made the drysuit a sized piece of its own).
 * The failure mode is specific: air in the suit expands on the way up, and a
 * diver who has never vented one rides it to the surface.
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
  /** Not renting a drysuit, or holding a card that clears a drysuit gate. Say nothing. */
  | { status: "ok" }
  /** Renting one with no drysuit card on file at all. */
  | { status: "no_card" }
  /** Renting one with a drysuit card on file that has not cleared: a capture awaiting review, or an unconfirmed import. */
  | { status: "unconfirmed" };

export function checkDrysuitCard(
  rentsDrysuit: boolean,
  specialtyCertifications: readonly SpecialtyCertification[],
): DrysuitCardCheck {
  if (!rentsDrysuit) return { status: "ok" };
  if (holdsSpecialtyCard(specialtyCertifications, "drysuit")) return { status: "ok" };
  // The split is worth two sentences for the same reason `specialtyBlocker`
  // splits its codes: "nothing on file" and "one tap from cleared" are
  // different jobs for the staffer reading the roster.
  return specialtyCertifications.some((card) => card.specialty === "drysuit")
    ? { status: "unconfirmed" }
    : { status: "no_card" };
}
