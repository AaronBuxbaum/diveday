import type { AppDb } from "@/db/client";
import { getTripPrepPage } from "@/db/trip-prep";
import type { requireShopSurface } from "@/lib/session";

type Shop = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

/**
 * **One departure's packing list, read once for both of its faces**: the Gear
 * tab (`../page.tsx`) and the packet's packing-list sheet. Null for a
 * departure that is gone or another shop's.
 */
export async function readPrepView(db: AppDb, shop: Shop, tripId: string, now: Date) {
  const page = await getTripPrepPage(db, shop, tripId, now);
  if (!page) return null;
  const { prep, stage, backFromBoat } = page;
  return {
    prep,
    shownStage: stage.shown,
    sailed: stage.sailed,
    finished: stage.finished,
    backFromBoat,
  };
}
