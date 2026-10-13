import type { BoatWorkCode, BoatWorkItem } from "@/lib/boat-work";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The words a boat's work wears (third review, item 4). `boatWorkItems`
 * (src/lib/boat-work.ts) decides which jobs a departure carries; this is the
 * one resolver both of its readers render them through, Today's rows for the
 * boat and the boat's own band, so "4 people missing rental sizes" is the same
 * four words on both screens.
 */
const BOAT_WORK_KEYS: Record<BoatWorkCode, StaffMessageKey> = {
  missing_sizes: "shared.boatWork.missingSizes",
  ungated_nitrox: "shared.boatWork.ungatedNitrox",
  missing_contact: "shared.boatWork.missingContact",
  open_orders: "shared.boatWork.openOrders",
};

export function boatWorkText(t: StaffTranslator, item: BoatWorkItem): string {
  return t(BOAT_WORK_KEYS[item.code], { count: item.count });
}

/** The same words as a Today row's sentence. */
export function boatWorkSentence(t: StaffTranslator, item: BoatWorkItem): string {
  return t("today.detail.boatWork", { work: boatWorkText(t, item) });
}
