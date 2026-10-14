import { urgencyFor } from "./today";

/**
 * **A boat's work, in one vocabulary** (third review, item 4). The jobs a
 * departure carries that are not hazards, decided once: Today's rows for the
 * boat and the boat's own band on the Divers tab both list these items, with
 * these counts, in this order, so the desk is never told the same boat's state
 * twice and differently. Hazards (who can't board, a missing instructor, a
 * boat clash) stay where they are; this is the "things to sort".
 *
 * The counts come from one db reader (`src/db/boat-work.ts`); the rules about
 * which of them is worth saying live here, framework-free.
 */
export type BoatWorkCode = "missing_sizes" | "ungated_nitrox" | "missing_contact" | "open_orders";

export type BoatWorkCounts = {
  missingFit: number;
  ungatedNitrox: number;
  missingContact: number;
  openOrders: number;
};

export type BoatWorkItem = { code: BoatWorkCode; count: number };

/**
 * The items worth saying about a boat, in reading order.
 *
 * A missing emergency contact is a dock-settleable nudge, worth raising only
 * once the boat is within three days (`urgencyFor` past "later"): further out
 * the diver still has time to fill it in. Every other item stands whatever
 * the date, because the packer, the fill station and the invoice each need
 * the answer before the day.
 */
export function boatWorkItems(
  counts: BoatWorkCounts,
  { startsAt, now }: { startsAt: Date; now: Date },
): BoatWorkItem[] {
  const close = urgencyFor(startsAt, now) !== "later";
  const items: BoatWorkItem[] = [
    { code: "missing_sizes", count: counts.missingFit },
    { code: "ungated_nitrox", count: counts.ungatedNitrox },
    { code: "missing_contact", count: close ? counts.missingContact : 0 },
    { code: "open_orders", count: counts.openOrders },
  ];
  return items.filter((item) => item.count > 0);
}
