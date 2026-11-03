import type { AppDb } from "./client";
import { readDayLoadOut } from "./closeout";
import type { TripPrepShop } from "./trip-prep";
import { listShopDayDepartures } from "./trips";

/**
 * The day's print packet's question in one call: the departures of the shop
 * day `at` falls in, and that day's load-out. Each departure's own sheet is
 * composed by the page from its trip readers.
 */
export async function getDayPrintPage(db: AppDb, shop: TripPrepShop, at: Date, now: Date) {
  const [departures, loadOut] = await Promise.all([
    listShopDayDepartures(db, shop.id, shop.timezone, at),
    readDayLoadOut(db, shop, at, now),
  ]);
  return { departures, loadOut };
}
