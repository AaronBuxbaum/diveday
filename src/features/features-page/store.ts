import { assistDarkReasonFor } from "@/features/assists";
import { canPersonManagePaymentSettings, canPersonManageStaffAccounts } from "../../db/authz";
import type { AppDb } from "../../db/client";

export { canPersonManageShopSettings } from "../../db/authz";

/**
 * The Features page's question in one call: which gated rows this person may
 * switch, and why assists are dark. The dark reason never fails the page: a read
 * that throws comes back as "unread".
 */
export async function getFeaturesPage(db: AppDb, shopId: string, personId: string) {
  const [payments, team, dark] = await Promise.all([
    canPersonManagePaymentSettings(db, shopId, personId),
    canPersonManageStaffAccounts(db, shopId, personId),
    assistDarkReasonFor(db, shopId).catch(() => "unread" as const),
  ]);
  return { can: { payments, team }, dark };
}
