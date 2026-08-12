import type { DiverMessageKey } from "@/i18n/messages";
import type { ExposureSuit } from "@/lib/diver-planning";

/**
 * `exposureSuitFor` returns a band code (src/lib/diver-planning.ts); this is
 * where each one becomes the sentence a diver reads. Thicknesses are written in
 * millimetres in every locale because that is how neoprene is sold everywhere,
 * including the markets that read feet and Fahrenheit.
 *
 * Shared by the two surfaces that say it, which never both say it at once: the
 * booking page states it under the water temperature on the conditions card,
 * and the pre-trip `/ready/[token]` page — which renders no conditions card at
 * all — states it in the packing list instead. One map, so the two cannot drift
 * into describing the same water differently.
 */
export const EXPOSURE_SUIT_KEYS: Record<ExposureSuit, DiverMessageKey> = {
  swimwear: "trip.exposureSuit.swimwear",
  shorty: "trip.exposureSuit.shorty",
  wetsuit5mm: "trip.exposureSuit.wetsuit5mm",
  wetsuit7mm: "trip.exposureSuit.wetsuit7mm",
  drysuit: "trip.exposureSuit.drysuit",
};
