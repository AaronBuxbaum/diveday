import { countDeparturesByBoat, listBoats } from "@/features/boats";
import type { AppDb } from "../../db/client";

export { canPersonManageBoats } from "../../db/authz";

/**
 * The fleet page's question in one call: every hull, and how many departures
 * each carries, so the confirm can say so before a shop taps Delete.
 */
export async function getBoatsPage(db: AppDb, shopId: string) {
  const [boats, departures] = await Promise.all([
    listBoats(db, shopId),
    countDeparturesByBoat(db, shopId),
  ]);
  return { boats, departures };
}
