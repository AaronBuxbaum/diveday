import type { AppDb } from "../../db/client";
import { countFitsAskingForDroppedItems } from "../../db/rental-fit";

export { canPersonManageRentalSettings } from "../../db/authz";

/** The rental settings page's question: how many fits ask for an item no longer offered. */
export async function getRentalSettingsPage(
  db: AppDb,
  shop: { id: string; rentalItems: readonly string[] },
) {
  return { droppedFits: await countFitsAskingForDroppedItems(db, shop.id, shop.rentalItems) };
}
