import type { RentalItemKind } from "@/lib/dive-prep";
import { rentalItemLabel } from "./rental-labels";
import { staffTranslator } from "./staff-messages";

/**
 * The staff note an import writes for a size it could not store (issue #1801),
 * in the shop's own language: "Prior shop recorded wetsuit 5mm".
 *
 * Its own module, not `rental-labels.ts`: that file is in the offline
 * manifest's client graph, and a value import of `staffTranslator` there would
 * ship every staff namespace to the boat rail.
 */
export function declinedSizeNote(
  locale: string | null | undefined,
  kind: RentalItemKind,
  value: string,
): string {
  const t = staffTranslator(locale);
  return t("settings.import.declinedSizeNote", { item: rentalItemLabel(t, kind), value });
}
