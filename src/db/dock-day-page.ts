import type { AppDb } from "./client";
import { listSiteBottomTimeOverrides } from "./dive-sites";

export { canPersonManageShopSettings } from "./authz";

/** The dock-day settings page's question: each site's bottom-time override. */
export async function getDockDayPage(db: AppDb, shopId: string) {
  return { siteBottomTimeOverrides: await listSiteBottomTimeOverrides(db, shopId) };
}
