import { countDeparturesByTripLens, listTripLenses } from "@/features/trip-lenses";
import type { AppDb } from "../../db/client";

export { canPersonManageTripTags } from "../../db/authz";

/** The trip tags page's question in one call: every lens and its departure count. */
export async function getTripTagsPage(db: AppDb, shopId: string) {
  const [lenses, departures] = await Promise.all([
    listTripLenses(db, shopId),
    countDeparturesByTripLens(db, shopId),
  ]);
  return { lenses, departures };
}
