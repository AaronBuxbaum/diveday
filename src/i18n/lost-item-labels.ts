import type { StaffTranslator } from "./staff-messages";

/**
 * **What is waiting for this diver** (fifth loop, item 7), on their check-in
 * row and their record: "In lost and found: Blue mask, black strap". The
 * descriptions are the crew's own words, which carry commas of their own, so
 * several are set apart with a middle dot rather than a list conjunction.
 */
export function foundItemsText(t: StaffTranslator, descriptions: readonly string[]): string {
  return t("desk.lostFound.waiting", { items: descriptions.join(" · ") });
}
