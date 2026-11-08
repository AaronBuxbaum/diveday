import type { AppDb } from "../../db/client";
import { getShopWhatsAppAccount } from "../../db/whatsapp-accounts";

export { canPersonManageMessagingSettings } from "../../db/authz";

/** The WhatsApp settings page's question: the shop's completed connection, if any. */
export async function getWhatsAppSettingsPage(db: AppDb, shopId: string) {
  return { account: await getShopWhatsAppAccount(db, shopId) };
}
