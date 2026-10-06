import type { SuitChoice } from "@/lib/rentals";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The staff fit editor's suit question (H-78). Kept out of `rental-labels.ts`
 * because the offline boat manifest imports that module and ships only the
 * `manifest` and `shared` namespaces; these words live in `divers`.
 */
const SUIT_CHOICE_KEYS: Record<SuitChoice, StaffMessageKey> = {
  own_wetsuit: "divers.rentalFit.suitChoices.own_wetsuit",
  rents_wetsuit: "divers.rentalFit.suitChoices.rents_wetsuit",
  own_drysuit: "divers.rentalFit.suitChoices.own_drysuit",
  rents_drysuit: "divers.rentalFit.suitChoices.rents_drysuit",
};

/** One answer to the staff fit editor's suit question (H-78). */
export function suitChoiceLabel(t: StaffTranslator, choice: SuitChoice): string {
  return t(SUIT_CHOICE_KEYS[choice]);
}
