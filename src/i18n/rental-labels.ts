import type { RentalFitLine, RentalItemKind } from "@/lib/dive-prep";
import type { DrysuitCardCheck } from "@/lib/drysuit-card";
import { cachedListFormat } from "@/lib/intl-cache";
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
 * Keyed by `RentalItemKind` (dive-prep.ts's packing-list alphabet, which
 * includes `boots`) since that's a superset of `RentableItemKind` (rentals.ts's
 * shop catalog) — every staff surface can index either kind space against the
 * same words.
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
  drysuit: "shared.rentalFit.itemLabels.drysuit",
  hood_gloves: "shared.rentalFit.itemLabels.hoodGloves",
  torch: "shared.rentalFit.itemLabels.torch",
  smb: "shared.rentalFit.itemLabels.smb",
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
 * **One rental piece is one unit on the line**: its spaces become U+00A0, so a
 * list of pieces breaks only at its own separators. Free-text sizes ("6 kg",
 * "US 9") and two-word items ("Mask & fins") broke inside themselves on the
 * manifest's person panel at 390 — "Weights 6" at the end of one line, "kg" on
 * the next — where the subtitle column is about 165px wide.
 */
function oneUnit(text: string): string {
  return text.replace(/\s+/g, "\u00A0");
}

/**
 * A staff-fit diver's stated sizes, one piece per item — "BCD L, Wetsuit M" —
 * for the packing line the captain reads with no way to open the profile.
 * Same `Intl.ListFormat` join as `rentalFitLineText`, just without a size
 * fallback: every item here already has one (`statedSizeItems`, dive-prep.ts,
 * only records a piece when its size is on file).
 */
export function statedSizesText(
  t: StaffTranslator,
  locale: string,
  items: { kind: "bcd" | "wetsuit" | "boots" | "mask_fins" | "drysuit"; size: string }[],
): string {
  const parts = items.map((item) =>
    oneUnit(
      t("shared.rentalFit.itemWithSize", { item: rentalItemLabel(t, item.kind), size: item.size }),
    ),
  );
  return cachedListFormat(locale, { style: "long", type: "unit" }).format(parts);
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
        const size = item.size ? oneUnit(item.size) : null;
        // A drysuit diver's fins. The stated size is the shoe size the fit
        // forms ask for, and the pair has to clear a vulcanised boot two to
        // three sizes bigger, so the rail reads the job rather than a number
        // to hand over (src/lib/dive-prep.ts's `rentedItems`). A sentence, so
        // only its size is one unit; the words around it can still wrap.
        const piece = item.drysuitFinFit
          ? size
            ? t("shared.rentalFit.itemOverDrysuitBootWithSize", { item: label, size })
            : t("shared.rentalFit.itemOverDrysuitBoot", { item: label })
          : oneUnit(size ? t("shared.rentalFit.itemWithSize", { item: label, size }) : label);
        // Wrapped rather than substituted, so the piece keeps whatever it
        // already said and gains the contradiction. A staffer reading the rail
        // is about to go and fetch this: "Drysuit ML" with nothing on it sends
        // them looking for a suit the shop stopped renting, which is the
        // disagreement between the rail and the packing list that issue #1804
        // opened on.
        return item.notOffered ? t("shared.rentalFit.itemNoLongerRented", { item: piece }) : piece;
      });
      return cachedListFormat(locale, { style: "long", type: "unit" }).format(parts);
    }
  }
}

/**
 * The staff-facing sentence for a drysuit rental with no card behind it
 * (src/lib/drysuit-card.ts returns the state, this picks the words — AGENTS.md:
 * domain returns codes, the UI picks the copy). Both sentences end in an action
 * and say in as many words that nothing is blocked, the same shape the depth
 * advisory uses, because a staffer who reads this as a refusal will start
 * looking for the override that does not exist.
 */
export function drysuitCardWarningText(
  t: StaffTranslator,
  check: Exclude<DrysuitCardCheck, { status: "ok" }>,
): string {
  return t(
    check.status === "unconfirmed"
      ? "shared.rentalFit.drysuitCardUnconfirmed"
      : "shared.rentalFit.drysuitCardMissing",
  );
}
