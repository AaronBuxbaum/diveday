import { departureBoatSafetyFor } from "@/db/boat-safety";
import type { DbExecutor } from "@/db/client";
import { boatSafetySection } from "@/i18n/boat-safety-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BoatSafetySection } from "@/lib/boat-safety";
import { nowDate } from "@/lib/clock";
import type { TripManifest } from "@/lib/manifests";

/**
 * **The boat itself** (roadmap N-08, N-10), read and worded once for the Boat
 * tab: the live section above the boat check and the offline copy's carry the
 * same value. Judged on the departure's own local date, and nothing at all
 * once that day is behind the shop.
 *
 * The departure checkpoint's manifest supplies both counts whichever
 * checkpoint is open: the people on the list, and how many the crew have
 * recorded aboard — the certificate line switches from "booked" to "aboard"
 * once the crew are counting more than it allows.
 *
 * Out of the route file so the page carries one call (`check:page-length`).
 */
export async function departureBoatSafetySection(
  db: DbExecutor,
  shop: { id: string; timezone: string },
  departure: Pick<TripManifest, "trip" | "summary">,
  t: StaffTranslator,
): Promise<BoatSafetySection | null> {
  const safety = await departureBoatSafetyFor(db, shop.id, {
    tripId: departure.trip.id,
    startsAt: departure.trip.startsAt,
    timeZone: shop.timezone,
    now: nowDate(),
    passengers: { booked: departure.summary.totalDivers, boarded: departure.summary.boarded },
  });
  return boatSafetySection(t, safety);
}
