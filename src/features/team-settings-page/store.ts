import { listShopStaff } from "@/features/staff-accounts";
import type { AppDb } from "../../db/client";
import { listStaffCredentials } from "../../db/staff-credentials";

export { canPersonManageStaffAccounts } from "../../db/authz";

/** The team page's question in one call: the shop's staff and their credentials. */
export async function getTeamSettingsPage(db: AppDb, shopId: string) {
  const [staff, credentials] = await Promise.all([
    listShopStaff(db, shopId),
    listStaffCredentials(db, shopId),
  ]);
  return { staff, credentials };
}
