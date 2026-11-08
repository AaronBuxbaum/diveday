import type { AppDb } from "../../db/client";
import {
  listShopActivityPeople,
  pagedShopActivity,
  type ShopActivityFilter,
} from "../../db/shop-activity";

export { canPersonViewShopActivity } from "../../db/authz";

/**
 * The activity log page's question in one call: one page of the shop's
 * activity under the filter, and the staff the filter can name.
 */
export async function getShopActivityPage(
  db: AppDb,
  shopId: string,
  filter: ShopActivityFilter,
  options: { page?: number },
) {
  const [log, staff] = await Promise.all([
    pagedShopActivity(db, shopId, filter, options),
    listShopActivityPeople(db, shopId),
  ]);
  return { log, staff };
}
