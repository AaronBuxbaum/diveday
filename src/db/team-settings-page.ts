import type { AppDb } from "./client";
import { listShopStaff } from "./staff-accounts";
import { listStaffCredentials } from "./staff-credentials";

export { canPersonManageStaffAccounts } from "./authz";

/** The team page's question in one call: the shop's staff and their credentials. */
export async function getTeamSettingsPage(db: AppDb, shopId: string) {
  const [staff, credentials] = await Promise.all([
    listShopStaff(db, shopId),
    listStaffCredentials(db, shopId),
  ]);
  return { staff, credentials };
}
