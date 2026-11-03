import type { AppDb } from "@/db/client";
import type { TripPrepShop } from "@/db/trip-prep";
import { listShopDayDepartures } from "@/db/trips";
import { readDayLoadOut } from "./closeout-reader";

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
