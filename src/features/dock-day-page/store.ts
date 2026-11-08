import type { AppDb } from "../../db/client";
import { listSiteBottomTimeOverrides } from "../../db/dive-sites";

export { canPersonManageShopSettings } from "../../db/authz";

/** The dock-day settings page's question: each site's bottom-time override. */
export async function getDockDayPage(db: AppDb, shopId: string) {
  return { siteBottomTimeOverrides: await listSiteBottomTimeOverrides(db, shopId) };
}
