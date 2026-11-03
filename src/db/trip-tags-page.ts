import type { AppDb } from "./client";
import { countDeparturesByTripLens, listTripLenses } from "./trip-lenses";

export { canPersonManageTripTags } from "./authz";

/** The trip tags page's question in one call: every lens and its departure count. */
export async function getTripTagsPage(db: AppDb, shopId: string) {
  const [lenses, departures] = await Promise.all([
    listTripLenses(db, shopId),
    countDeparturesByTripLens(db, shopId),
  ]);
  return { lenses, departures };
}
