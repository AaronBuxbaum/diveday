import type { RentalFitLine, RentalItemKind } from "@/lib/dive-prep";
import type { RentableItemKind, ShopCatalogKind } from "@/lib/rentals";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * `src/lib/dive-prep.ts` and `src/lib/rentals.ts` return item *codes*, never
 * rendered words (see the domain-strings-common notes on a domain function
 * rendered on both a staff and a diver page). This is the staff-side lookup
 * for every one of those codes; `RentalFitForm.tsx` (the one diver-facing
 * caller of `src/lib/rentals.ts`'s catalog) keeps its own map against
 * diver.json instead of importing this one, so the two bundles never tangle.
 *
 * Keyed by `RentalItemKind` (dive-prep.ts's 8-item packing-list alphabet,
 * which includes `boots`) since that's a superset of `RentableItemKind`
 * (rentals.ts's 7-item shop catalog) — every staff surface can index either
 * kind space against the same words.
 */
const RENTAL_ITEM_LABEL_KEYS: Record<RentalItemKind, StaffMessageKey> = {
  bcd: "shared.rentalFit.itemLabels.bcd",
  regulator: "shared.rentalFit.itemLabels.regulator",
  wetsuit: "shared.rentalFit.itemLabels.wetsuit",
  boots: "shared.rentalFit.itemLabels.boots",
  mask_fins: "shared.rentalFit.itemLabels.maskFins",
  weights: "shared.rentalFit.itemLabels.weights",
  dive_computer: "shared.rentalFit.itemLabels.diveComputer",
  gopro: "shared.rentalFit.itemLabels.gopro",
};

/** A dive-prep packing-list item's word, e.g. for `PrepLine.kind` or a `RentalFitLine`'s items. */
export function rentalItemLabel(t: StaffTranslator, kind: RentalItemKind): string {
  return t(RENTAL_ITEM_LABEL_KEYS[kind]);
}

/** A shop catalog gear item's word (rentals.ts's `RentableItemKind`) — never includes `boots`. */
export function rentableItemLabel(t: StaffTranslator, kind: RentableItemKind): string {
  return t(RENTAL_ITEM_LABEL_KEYS[kind]);
}

/** A shop catalog entry's word, including the synthetic `nitrox` fills row. */
export function catalogItemLabel(t: StaffTranslator, kind: ShopCatalogKind): string {
  if (kind === "nitrox") return t("shared.rentalFit.nitroxFillsLabel");
  return rentableItemLabel(t, kind);
}

/**
 * The one-line fit `rentalFitLine()` (src/lib/dive-prep.ts) reduces a
 * diver's rental fit to — resolved into a sentence against the staff bundle.
 * Mirrors `readinessBlockerText`'s shape: the lib function hands back a code
 * (+ params), this resolves every param that is itself a label through its
 * own key first, so the outer template only ever receives finished words.
 *
 * The "rents" item list is comma-joined through `Intl.ListFormat` rather than
 * a hard-coded `", "` — locale-correct list punctuation, same approach as
 * `RequirementsSection.tsx`'s site-requirement list.
 */
export function rentalFitLineText(t: StaffTranslator, locale: string, line: RentalFitLine): string {
  switch (line.state) {
    case "not_recorded":
      return t("shared.rentalFit.notRecorded");
    case "own_kit":
      return t("shared.rentalFit.ownKit");
    case "needs_staff_fit":
      return line.note
        ? t("shared.rentalFit.needsStaffFitWithNote", { note: line.note })
        : t("shared.rentalFit.needsStaffFit");
    case "rents": {
      const parts = line.items.map((item) => {
        const label = rentalItemLabel(t, item.kind);
        return item.size
          ? t("shared.rentalFit.itemWithSize", { item: label, size: item.size })
          : label;
      });
      return new Intl.ListFormat(locale, { style: "long", type: "unit" }).format(parts);
    }
  }
}
