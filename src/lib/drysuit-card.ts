import type { SpecialtyCertification } from "@/db/schema";
import { holdsSpecialtyCard } from "./readiness";
import { toRentableKinds } from "./rentals";

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
  /**
   * No rental drysuit is going out — the diver does not take one, or the shop
   * does not rent them any more — or they hold a card that clears a drysuit
   * gate. Say nothing.
   */
  | { status: "ok" }
  /** Renting one with no drysuit card on file at all. */
  | { status: "no_card" }
  /** Renting one with a drysuit card on file that has not cleared: a capture awaiting review, or an unconfirmed import. */
  | { status: "unconfirmed" };

/**
 * `shopRentalItems` is the shop's own catalog (`shops.rental_items`), and it is
 * a **parameter rather than an assumption** because this advisory's whole
 * premise is a suit coming off this shop's wall.
 *
 * `rents_drysuit` outlives a shop dropping drysuits from its catalog, which is
 * right — the diver's answer was theirs, and a catalog edit is not the diver
 * speaking (`saveRentalFit`, issue #1755). What it stops being is evidence that
 * a suit is going out. A shop that trials drysuit rental for a season and
 * unticks it would otherwise hand every diver who ever ticked the box a
 * permanent danger-toned line about a card they have no reason to hold, and
 * **no way to clear it**: the checkbox no longer renders, so neither a staffer
 * nor the diver can retract the flag, and the only exits are a specialty
 * course or putting the item back. A warning with no honest exit is the one a
 * crew learns to click past, and the cost lands on the next warning
 * (glossary — **Rental catalog**).
 *
 * This is not a claim that the diver does not dive dry. `rents_drysuit` records
 * what the **shop hands over**; DiveDay has no field for a suit the diver owns
 * — that gap is issue #1752, open and `ready-for-human` because where the fact
 * lives is a product-model decision — and reading one column as the other is
 * the over-reach that issue is about. The contradiction itself is
 * not swallowed: the packing list keeps the drysuit piece and says the shop no
 * longer rents it (`PrepPiece.notOffered`, `src/lib/dive-prep.ts`), which is
 * the surface where gear is reasoned about and a form a staffer can close.
 *
 * `undefined` means the caller has no catalog to hand, and then the advisory is
 * raised — over-warning is the safe direction for something that gates nothing.
 */
export function checkDrysuitCard(
  rentsDrysuit: boolean,
  specialtyCertifications: readonly SpecialtyCertification[],
  shopRentalItems: readonly string[] | undefined,
): DrysuitCardCheck {
  if (!rentsDrysuit) return { status: "ok" };
  if (shopRentalItems && !toRentableKinds(shopRentalItems).includes("drysuit")) {
    return { status: "ok" };
  }
  if (holdsSpecialtyCard(specialtyCertifications, "drysuit")) return { status: "ok" };
  // The split is worth two sentences for the same reason `specialtyBlocker`
  // splits its codes: "nothing on file" and "one tap from cleared" are
  // different jobs for the staffer reading the roster.
  return specialtyCertifications.some((card) => card.specialty === "drysuit")
    ? { status: "unconfirmed" }
    : { status: "no_card" };
}
