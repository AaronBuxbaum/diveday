import type { AppDb } from "@/db/client";
import { listTripUnitsToCheckIn } from "@/db/gear";
import { meetingWindowsByTrip } from "@/db/trip-meeting-windows";
import { getTripPrep } from "@/db/trip-prep";
import { latestTripStage } from "@/db/trip-stages";
import type { requireShopSurface } from "@/lib/session";
import { readDepartureStage } from "../../_arrivals/departure-record";

type Shop = Awaited<ReturnType<typeof requireShopSurface>>["shop"];

/**
 * **One departure's packing list, read once for both of its faces**: the Gear
 * tab (`../page.tsx`) and the packet's packing-list sheet. Null for a
 * departure that is gone or another shop's.
 */
export async function readPrepView(db: AppDb, shop: Shop, tripId: string, now: Date) {
  const [prep, stageReading] = await Promise.all([
    getTripPrep(db, shop, tripId),
    latestTripStage(db, shop.id, tripId),
  ]);
  if (!prep) return null;
  const { trip } = prep;
  // The crew's word for the header chip, and whether the boat has left the dock.
  const {
    shown: shownStage,
    sailed,
    finished,
  } = await readDepartureStage(db, shop.id, tripId, {
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    now,
    timeZone: shop.timezone,
    stage: stageReading,
    cancelled: trip.status === "cancelled",
    meetingWindows: (await meetingWindowsByTrip(db, [trip])).get(tripId),
  });
  // Once home, every unit still out on this boat (fifth-loop ideas, item 5).
  const backFromBoat = finished ? await listTripUnitsToCheckIn(db, shop.id, tripId) : [];
  return { prep, shownStage, sailed, finished, backFromBoat };
}
