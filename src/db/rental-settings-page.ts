import type { AppDb } from "./client";
import { countFitsAskingForDroppedItems } from "./rental-fit";

export { canPersonManageRentalSettings } from "./authz";

/** The rental settings page's question: how many fits ask for an item no longer offered. */
export async function getRentalSettingsPage(
  db: AppDb,
  shop: { id: string; rentalItems: readonly string[] },
) {
  return { droppedFits: await countFitsAskingForDroppedItems(db, shop.id, shop.rentalItems) };
}
